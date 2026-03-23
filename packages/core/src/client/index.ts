'use client'

import { useRouter } from 'next/navigation'

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
const FRAPPE_PATHS = ['/app', '/api', '/assets', '/files', '/private']

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
