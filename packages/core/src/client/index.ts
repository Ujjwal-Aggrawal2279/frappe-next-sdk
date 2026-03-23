'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionResult, GetListArgs } from '../types'

// Browser-side fetcher. Uses relative URLs — browser auto-sends cookies.
// Reads window.csrf_token injected by FrappeNextProvider.

type FrappeEnvelope<T> = { message: T }
type Params = Record<string, unknown>

function readCsrfToken(): string {
  if (typeof window === 'undefined') return 'fetch'
  const w = window as typeof window & { csrf_token?: string }
  if (w.csrf_token) return w.csrf_token
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)
  return m?.[1] ?? 'fetch'
}

export async function frappeClientGet<T>(
  method:  string,
  params?: Params,
): Promise<T> {
  const url = new URL(`/api/method/${method}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) url.searchParams.set(k, String(v))
    })
  }
  const res = await fetch(url.toString(), {
    credentials: 'include',
    headers:     { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Frappe ${res.status}: ${method}`)
  const data: FrappeEnvelope<T> = await res.json()
  return data.message
}

export async function frappeClientPost<T>(
  method: string,
  body?:  Params,
): Promise<T> {
  const res = await fetch(`/api/method/${method}`, {
    method:      'POST',
    credentials: 'include',
    headers: {
      'Content-Type':        'application/json',
      'X-Frappe-CSRF-Token': readCsrfToken(),
    },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(`Frappe ${res.status}: ${method}`)
  const data: FrappeEnvelope<T> = await res.json()
  return data.message
}

// ─── frappeLogin ──────────────────────────────────────────────────────────────
// Dedicated login — returns the full Frappe response body, not just .message,
// because login includes home_page and full_name alongside the message string.

export interface FrappeLoginResponse {
  message:   string        // "Logged In" | "No App" etc.
  home_page?: string       // e.g. "/me", "/" — use for post-login redirect
  full_name?: string
}

export async function frappeLogin(
  usr: string,
  pwd: string,
): Promise<FrappeLoginResponse> {
  const res = await fetch('/api/method/login', {
    method:      'POST',
    credentials: 'include',
    headers: {
      'Content-Type':        'application/json',
      'X-Frappe-CSRF-Token': readCsrfToken(),
    },
    body: JSON.stringify({ usr, pwd }),
  })
  if (!res.ok) throw new Error(`Frappe ${res.status}: login`)
  return res.json() as Promise<FrappeLoginResponse>
}

// ─── useFrappeRouter ──────────────────────────────────────────────────────────
// Smart router that automatically decides between Next.js client-side navigation
// and full-page navigation for Frappe-owned paths (/app, /files, etc.).
//
// Usage:
//   const { navigate, toDesk, toDoc } = useFrappeRouter()
//   navigate('/dashboard')          → Next.js router.push (SPA, no reload)
//   navigate('/app')                → window.location.href (Frappe desk)
//   toDesk()                        → /app
//   toDesk('item')                  → /app/item
//   toDoc('Sales Order', 'SO-0001') → /app/sales-order/SO-0001

// Paths owned by Frappe — anything else is handled by Next.js
const FRAPPE_PATHS = [
  '/app', '/api', '/assets', '/files', '/private',
  '/me', '/update-password', '/print', '/list', '/form', '/tree', '/report', '/dashboard',
]

function isFrappePath(path: string): boolean {
  return FRAPPE_PATHS.some(p => path === p || path.startsWith(p + '/'))
}

function doctypeToSlug(doctype: string): string {
  return doctype.toLowerCase().replace(/\s+/g, '-')
}

export function useFrappeRouter() {
  const router = useRouter()

  function navigate(path: string): void {
    if (isFrappePath(path)) {
      window.location.href = path
    } else {
      router.push(path)
    }
  }

  function toDesk(module?: string): void {
    window.location.href = module ? `/app/${module}` : '/app'
  }

  function toDoc(doctype: string, name?: string): void {
    const slug = doctypeToSlug(doctype)
    window.location.href = name
      ? `/app/${slug}/${encodeURIComponent(name)}`
      : `/app/${slug}`
  }

  return { navigate, toDesk, toDoc }
}

// ─── useFrappeDoc ─────────────────────────────────────────────────────────────
// Fetches a single Frappe document in a Client Component.
// Ships optimistic update() — UI reflects the change instantly, rolls back on error.
//
// Usage:
//   const { doc, isLoading, error, update } = useFrappeDoc<Customer>("Customer", "CUST-0001")
//   await update({ customer_name: "New Name" })  // optimistic — no spinner needed

export interface UseDocResult<T> {
  doc:       T | null
  isLoading: boolean
  error:     Error | null
  /** Re-fetch from Frappe. */
  mutate:    () => void
  /**
   * Optimistically update fields on the document.
   * UI updates immediately; rolls back automatically if the server call fails.
   */
  update:    (changes: Partial<T>) => Promise<void>
}

export function useFrappeDoc<T>(
  doctype: string,
  name:    string,
): UseDocResult<T> {
  const [doc,       setDoc]       = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await frappeClientGet<T>('frappe.client.get', { doctype, name })
      setDoc(data)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsLoading(false)
    }
  }, [doctype, name])

  useEffect(() => { fetch() }, [fetch])

  const update = useCallback(async (changes: Partial<T>) => {
    const prev = doc
    // Optimistic — reflect change immediately
    setDoc(curr => curr ? { ...curr, ...changes } : curr)
    try {
      const confirmed = await frappeClientPost<T>(
        'frappe.client.set_value',
        { doctype, name, fieldname: JSON.stringify(changes) },
      )
      setDoc(confirmed)
    } catch (e) {
      setDoc(prev)  // Rollback
      throw e instanceof Error ? e : new Error(String(e))
    }
  }, [doc, doctype, name])

  return { doc, isLoading, error, mutate: fetch, update }
}

// ─── useFrappeList ────────────────────────────────────────────────────────────
// Fetches a list of Frappe documents in a Client Component.
// When `fields` is provided the return type narrows to Pick<T, fields[number]>[]
// — the same Pick inference as the server-side getList().
//
// Usage:
//   const { list } = useFrappeList<Customer>("Customer", {
//     fields:  ["name", "customer_name"],   // → Pick<Customer, "name"|"customer_name">[]
//     filters: [["disabled", "=", 0]],
//   })

export interface UseListResult<T> {
  list:      T[] | null
  isLoading: boolean
  error:     Error | null
  /** Re-fetch from Frappe. */
  mutate:    () => void
}

// Overload 1 — fields specified → Pick<T, F[number]>[]
export function useFrappeList<T, const F extends ReadonlyArray<keyof T & string>>(
  doctype: string,
  args:    Omit<GetListArgs, 'fields'> & { fields: F },
): UseListResult<Pick<T, F[number]>>

// Overload 2 — no fields → full T[]
export function useFrappeList<T = Record<string, unknown>>(
  doctype: string,
  args?:   GetListArgs,
): UseListResult<T>

export function useFrappeList<T>(
  doctype: string,
  args?:   GetListArgs,
): UseListResult<T> {
  const [list,      setList]      = useState<T[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState<Error | null>(null)

  // Stable dependency key — avoids re-fetching on every render when args is inline
  const argsKey = JSON.stringify(args)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const {
        fields      = ['name', 'modified'],
        filters     = [],
        or_filters  = [],
        limit       = 20,
        limit_start = 0,
        order_by    = 'modified desc',
      } = args ?? {}

      const data = await frappeClientGet<T[]>('frappe.client.get_list', {
        doctype,
        fields:            JSON.stringify(fields),
        filters:           JSON.stringify(filters),
        or_filters:        JSON.stringify(or_filters),
        limit_page_length: limit,
        limit_start,
        order_by,
      })
      setList(data)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, argsKey])

  useEffect(() => { fetch() }, [fetch])

  return { list, isLoading, error, mutate: fetch }
}

// ─── useAction ────────────────────────────────────────────────────────────────
// Wraps a Server Action (or any async function returning ActionResult<T>)
// with isPending / data / error state — no boilerplate useState needed.
//
// Usage:
//   const { execute, data, isPending, error } = useAction(createCustomerAction)
//
//   <button onClick={() => execute({ customer_name: "Acme" })} disabled={isPending}>
//     {isPending ? "Saving…" : "Save"}
//   </button>
//
// Works with @frappe-next/core/actions helpers (createDoc, updateDoc, etc.)
// and any custom Server Action that returns ActionResult<T>.

export interface UseActionResult<TInput, TOutput> {
  execute:   (input: TInput) => Promise<ActionResult<TOutput>>
  data:      TOutput | null
  isPending: boolean
  error:     string | null
  /** Reset data and error back to null. */
  reset:     () => void
}

export function useAction<TInput, TOutput>(
  action: (input: TInput) => Promise<ActionResult<TOutput>>,
): UseActionResult<TInput, TOutput> {
  const [isPending, setIsPending] = useState(false)
  const [data,      setData]      = useState<TOutput | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  // Keep a stable ref so callers don't need to memoize the action themselves
  const actionRef = useRef(action)
  actionRef.current = action

  const execute = useCallback(async (input: TInput): Promise<ActionResult<TOutput>> => {
    setIsPending(true)
    setError(null)
    try {
      const result = await actionRef.current(input)
      if (result.ok) {
        setData(result.data)
      } else {
        setError(result.error)
      }
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      return { ok: false, error: msg }
    } finally {
      setIsPending(false)
    }
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { execute, data, isPending, error, reset }
}
