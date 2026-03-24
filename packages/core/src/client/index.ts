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

  // Stable ref for the latest doc value — keeps `update` out of the dep array
  // so it never triggers downstream useEffect([update]) re-runs.
  const docRef = useRef<T | null>(null)
  docRef.current = doc

  const fetch = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)
    try {
      const url = new URL('/api/method/frappe.client.get', window.location.origin)
      url.searchParams.set('doctype', doctype)
      url.searchParams.set('name', name)
      const res = await window.fetch(url.toString(), { credentials: 'include', signal })
      if (res.ok) {
        const { message } = await res.json() as { message: T }
        setDoc(message)
      } else {
        throw new Error(`Frappe ${res.status}: frappe.client.get`)
      }
    } catch (e) {
      // AbortError is not a real error — swallow it silently
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsLoading(false)
    }
  }, [doctype, name])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(ctrl.signal)
    // Cleanup: cancel the in-flight request when deps change or component unmounts.
    // This prevents stale responses from overwriting newer state (React Strict Mode safe).
    return () => ctrl.abort()
  }, [fetch])

  const mutate = useCallback(() => { fetch() }, [fetch])

  const update = useCallback(async (changes: Partial<T>) => {
    const prev = docRef.current
    // Optimistic — reflect the change in UI immediately
    setDoc(curr => curr ? { ...curr, ...changes } : curr)
    try {
      const confirmed = await frappeClientPost<T>(
        'frappe.client.set_value',
        { doctype, name, fieldname: JSON.stringify(changes) },
      )
      setDoc(confirmed)
    } catch (e) {
      // Rollback to the server-confirmed state before the optimistic update
      setDoc(prev)
      throw e instanceof Error ? e : new Error(String(e))
    }
  // doctype + name are the only stable identifiers needed — docRef holds latest doc
  }, [doctype, name])

  return { doc, isLoading, error, mutate, update }
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

  // Serialise args once per render for stable dep comparison.
  // JSON.stringify of identical args always produces the same string,
  // so inline objects like { filters: [...] } don't cause infinite loops.
  const argsKey = JSON.stringify(args)

  const fetch = useCallback(async (signal?: AbortSignal) => {
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
      } = (JSON.parse(argsKey) as GetListArgs | undefined) ?? {}

      const url = new URL('/api/method/frappe.client.get_list', window.location.origin)
      url.searchParams.set('doctype',          doctype)
      url.searchParams.set('fields',           JSON.stringify(fields))
      url.searchParams.set('filters',          JSON.stringify(filters))
      url.searchParams.set('or_filters',       JSON.stringify(or_filters))
      url.searchParams.set('limit_page_length', String(limit))
      url.searchParams.set('limit_start',      String(limit_start))
      url.searchParams.set('order_by',         order_by)

      const res = await window.fetch(url.toString(), { credentials: 'include', signal })
      if (res.ok) {
        const { message } = await res.json() as { message: T[] }
        setList(message)
      } else {
        throw new Error(`Frappe ${res.status}: frappe.client.get_list`)
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setIsLoading(false)
    }
  // argsKey is the stable serialised proxy for args
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, argsKey])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(ctrl.signal)
    // Abort the previous request whenever doctype or args change — prevents
    // a slow earlier request from overwriting the result of a faster later one.
    return () => ctrl.abort()
  }, [fetch])

  const mutate = useCallback(() => { fetch() }, [fetch])

  return { list, isLoading, error, mutate }
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

// ─── useFrappeFileUpload ──────────────────────────────────────────────────────
// Upload a file to Frappe with real-time progress tracking via XHR.
// Uses the native XHR upload API — no extra dependencies.
// Optionally attach the file to a specific document + field.
//
// Usage:
//   const { upload, isUploading, progress, error } = useFrappeFileUpload()
//
//   <input type="file" onChange={e => upload(e.target.files[0])} />
//   {isUploading && <progress value={progress} max={100} />}
//
//   // Attach directly to a document:
//   upload(file, { doctype: "Sales Order", docname: "SO-0001", isPrivate: true })

export interface FrappeFile {
  name:       string
  file_name:  string
  /** Public URL to access the file via the browser */
  file_url:   string
  is_private: 0 | 1
  file_size:  number
}

export interface UseFileUploadOptions {
  doctype?:   string
  docname?:   string
  fieldname?: string
  folder?:    string
  /** Store the file as private (only accessible to logged-in users). Default: false */
  isPrivate?: boolean
}

export interface UseFileUploadResult {
  /** Upload a File object. Resolves to the Frappe file record on success. */
  upload:      (file: File, options?: UseFileUploadOptions) => Promise<FrappeFile>
  isUploading: boolean
  /** Upload progress 0–100 */
  progress:    number
  error:       Error | null
  reset:       () => void
}

export function useFrappeFileUpload(): UseFileUploadResult {
  const [isUploading, setIsUploading] = useState(false)
  const [progress,    setProgress]    = useState(0)
  const [error,       setError]       = useState<Error | null>(null)
  // Abort any in-progress upload on unmount
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  useEffect(() => () => { xhrRef.current?.abort() }, [])

  const upload = useCallback((
    file:    File,
    options: UseFileUploadOptions = {},
  ): Promise<FrappeFile> => {
    setIsUploading(true)
    setProgress(0)
    setError(null)

    return new Promise<FrappeFile>((resolve, reject) => {
      const formData = new FormData()
      formData.append('file',       file, file.name)
      formData.append('is_private', options.isPrivate ? '1' : '0')
      if (options.doctype)   formData.append('doctype',   options.doctype)
      if (options.docname)   formData.append('docname',   options.docname)
      if (options.fieldname) formData.append('fieldname', options.fieldname)
      if (options.folder)    formData.append('folder',    options.folder)

      const xhr = new XMLHttpRequest()
      xhrRef.current = xhr

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      }

      xhr.onload = () => {
        setIsUploading(false)
        xhrRef.current = null
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText) as { message: FrappeFile }
            setProgress(100)
            resolve(body.message)
          } catch {
            const err = new Error('Invalid upload response')
            setError(err); reject(err)
          }
        } else {
          const err = new Error(`Upload failed: HTTP ${xhr.status}`)
          setError(err); reject(err)
        }
      }

      xhr.onerror = () => {
        setIsUploading(false)
        xhrRef.current = null
        const err = new Error('Network error during upload')
        setError(err); reject(err)
      }

      xhr.onabort = () => {
        setIsUploading(false)
        xhrRef.current = null
        reject(new Error('Upload cancelled'))
      }

      xhr.open('POST', '/api/method/upload_file')
      xhr.setRequestHeader('X-Frappe-CSRF-Token', readCsrfToken())
      xhr.withCredentials = true
      xhr.send(formData)
    })
  }, [])

  const reset = useCallback(() => {
    xhrRef.current?.abort()
    setIsUploading(false)
    setProgress(0)
    setError(null)
  }, [])

  return { upload, isUploading, progress, error, reset }
}

// ─── useSearchLink ────────────────────────────────────────────────────────────
// Debounced autocomplete hook for Frappe Link fields.
// Calls frappe.desk.search.search_link with 300ms debounce.
// Drop-in for any search-as-you-type input that resolves a DocType name.
//
// Usage:
//   const { results, search, isLoading } = useSearchLink("Customer")
//
//   <input onChange={e => search(e.target.value)} />
//   {results.map(r => <div key={r.value}>{r.label ?? r.value}</div>)}

export interface SearchLinkResult {
  value:        string
  label?:       string
  description?: string
}

export interface UseSearchLinkOptions {
  filters?:    Record<string, unknown>
  pageLength?: number
}

export interface UseSearchLinkResult {
  results:   SearchLinkResult[]
  /** Call this with the current input value to trigger a search. */
  search:    (query: string) => void
  isLoading: boolean
  /** Clear results (e.g. on input blur). */
  clear:     () => void
}

export function useSearchLink(
  doctype: string,
  options?: UseSearchLinkOptions,
): UseSearchLinkResult {
  const [results,   setResults]   = useState<SearchLinkResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable serialised options key for dependency comparison
  const optsKey = JSON.stringify(options)

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const opts: UseSearchLinkOptions = JSON.parse(optsKey) as UseSearchLinkOptions
        const params: Record<string, unknown> = {
          doctype,
          txt:         query,
          page_length: opts.pageLength ?? 10,
        }
        if (opts.filters) params.filters = JSON.stringify(opts.filters)

        const data = await frappeClientGet<SearchLinkResult[]>(
          'frappe.desk.search.search_link',
          params as Record<string, string | number | boolean>,
        )
        setResults(Array.isArray(data) ? data : [])
      } catch {
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 300)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, optsKey])

  const clear = useCallback(() => setResults([]), [])

  return { results, search, isLoading, clear }
}
