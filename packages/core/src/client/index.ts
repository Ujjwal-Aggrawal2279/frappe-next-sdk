'use client'

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
