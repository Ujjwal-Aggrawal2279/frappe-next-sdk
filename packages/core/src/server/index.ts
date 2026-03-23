import 'server-only'
import { cache }              from 'react'
import { revalidateTag }      from 'next/cache'
import { cookies, headers }   from 'next/headers'
import type {
  FrappeDoc, FrappeEnvelope, FrappeParams,
  FrappeFetchOptions, GetListArgs, BootData, FrappeFilter,
} from '../types'

// ─── URL Resolution ───────────────────────────────────────────────────────────
// Priority order:
//   1. FRAPPE_INTERNAL_URL  → Docker  (http://frappe-backend:8000)
//   2. FRAPPE_URL           → Explicit override
//   3. http://127.0.0.1:8000 → Local bench fallback (no env var needed)

function resolveBaseUrl(): string {
  return (
    process.env.FRAPPE_INTERNAL_URL ??
    process.env.FRAPPE_URL          ??
    'http://127.0.0.1:8000'
  )
}

// ─── Request Timeout ──────────────────────────────────────────────────────────
// Prevents server components from hanging indefinitely on slow Frappe responses.
// Override with FRAPPE_REQUEST_TIMEOUT=10000 (ms) in .env.local.
// Defaults to 8 s — enough for cold Frappe starts, tight enough to fail fast.

function requestSignal(): AbortSignal {
  const ms = parseInt(process.env.FRAPPE_REQUEST_TIMEOUT ?? '8000', 10)
  return AbortSignal.timeout(ms)
}

// ─── Cookie Forwarding ────────────────────────────────────────────────────────
// Reads the INCOMING request's cookies (via Next.js 15 async cookies())
// and forwards them to Frappe to maintain the user's session server-side.

async function buildSessionHeaders(): Promise<Record<string, string>> {
  try {
    const jar  = await cookies()
    const sid  = jar.get('sid')?.value
    const csrf = jar.get('csrf_token')?.value
    const out: Record<string, string> = {}
    if (sid && sid !== 'Guest') out['Cookie']              = `sid=${sid}`
    if (csrf)                   out['X-Frappe-CSRF-Token'] = csrf
    return out
  } catch {
    // Outside request context (build time, cron jobs) — skip session
    return {}
  }
}

// ─── API Key Auth ─────────────────────────────────────────────────────────────
// Used for server-side mutations. Bypasses CSRF entirely.
// Set FRAPPE_API_KEY + FRAPPE_API_SECRET in .env.local

function buildApiKeyHeaders(): Record<string, string> | null {
  const key    = process.env.FRAPPE_API_KEY
  const secret = process.env.FRAPPE_API_SECRET
  if (!key || !secret) return null
  return { 'Authorization': `token ${key}:${secret}` }
}

// ─── Response Handler ─────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response, method: string): Promise<T> {
  if (res.status === 403) throw new FrappeAuthError(method)
  if (res.status === 404) throw new FrappeNotFoundError(method)
  if (!res.ok) {
    let details: unknown = {}
    try { details = await res.json() } catch { /* noop */ }
    throw new FrappeApiError(res.status, method, details)
  }
  const envelope = await res.json() as FrappeEnvelope<T>
  if (envelope.exc_type) throw new FrappeApiError(200, method, envelope)
  return envelope.message
}

// ─── frappeGet ────────────────────────────────────────────────────────────────
// Use inside Server Components, generateStaticParams, generateMetadata.
// Pass options.next for ISR: { revalidate: 60 } or { tags: ['MyDoctype'] }

export async function frappeGet<T>(
  method:  string,
  params?: FrappeParams,
  options: FrappeFetchOptions = {},
): Promise<T> {
  const base    = resolveBaseUrl()
  const url     = new URL(`/api/method/${method}`, base)
  const session = options.skipSession ? {} : await buildSessionHeaders()

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v))
    })
  }

  const init = {
    method:  'GET',
    headers: { 'Content-Type': 'application/json', ...session, ...options.headers },
    next:    options.next,
    signal:  requestSignal(),
  } as unknown as RequestInit

  const res = await fetch(url.toString(), init)
  return handleResponse<T>(res, method)
}

// ─── frappePost ───────────────────────────────────────────────────────────────
// Prefers API key for mutations (no CSRF issue server-to-server).
// Falls back to session cookie if API key not configured.

export async function frappePost<T>(
  method:  string,
  body?:   FrappeParams,
  options: FrappeFetchOptions = {},
): Promise<T> {
  const base    = resolveBaseUrl()
  const apiKey  = buildApiKeyHeaders()
  const session = options.skipSession ? {} : await buildSessionHeaders()
  const auth    = apiKey ?? session

  const res = await fetch(`${base}/api/method/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...auth, ...options.headers },
    body:    JSON.stringify(body ?? {}),
    cache:   'no-store',
    signal:  requestSignal(),
  })

  return handleResponse<T>(res, method)
}

// ─── Document Helpers ─────────────────────────────────────────────────────────

// Internal: React.cache() deduplicates getDoc calls within a single request.
// 10 Server Components calling getDoc('Item','ITEM-001') = exactly 1 Frappe call.
// Keyed on (doctype, name) — the 95% case. Custom options bypass the memo.
const _getDocMemo = cache(
  (doctype: string, name: string): Promise<unknown> =>
    frappeGet<unknown>(
      'frappe.client.get',
      { doctype, name },
      { next: { tags: [`${doctype}::${name}`] } },
    ),
)

export function getDoc<T>(
  doctype:  string,
  name:     string,
  options?: FrappeFetchOptions,
): Promise<T> {
  if (!options) return _getDocMemo(doctype, name) as Promise<T>
  return frappeGet<T>(
    'frappe.client.get',
    { doctype, name },
    { next: { tags: [`${doctype}::${name}`] }, ...options },
  )
}

// Returns null on 404 instead of throwing — no try/catch needed for optional docs.
export async function getDocOrNull<T>(
  doctype:  string,
  name:     string,
  options?: FrappeFetchOptions,
): Promise<T | null> {
  try {
    return await getDoc<T>(doctype, name, options)
  } catch (err) {
    if (err instanceof FrappeNotFoundError) return null
    throw err
  }
}

export async function getList<T>(
  doctype:  string,
  args:     GetListArgs = {},
  options?: FrappeFetchOptions,
): Promise<T[]> {
  const {
    fields      = ['name', 'modified'],
    filters     = [],
    or_filters  = [],
    limit       = 20,
    limit_start = 0,
    order_by    = 'modified desc',
  } = args

  return frappeGet<T[]>(
    'frappe.client.get_list',
    {
      doctype,
      fields:            JSON.stringify(fields),
      filters:           JSON.stringify(filters),
      or_filters:        JSON.stringify(or_filters),
      limit_page_length: limit,
      limit_start,
      order_by,
    },
    { next: { tags: [doctype] }, ...options },
  )
}

export async function getCount(
  doctype:  string,
  filters:  FrappeFilter[] = [],
  options?: FrappeFetchOptions,
): Promise<number> {
  return frappeGet<number>(
    'frappe.client.get_count',
    { doctype, filters: JSON.stringify(filters) },
    options,
  )
}

// ─── ISR Cache Invalidation ───────────────────────────────────────────────────
// Call from Server Actions after mutations to invalidate Next.js ISR cache.
// Pairs with the cache tags set by getDoc and getList.
//
// Usage in a Server Action:
//   await updateDoc('Item', 'ITEM-001', { price: 99 })
//   revalidateDoc('Item', 'ITEM-001')   // invalidates getDoc cache for this doc
//   revalidateList('Item')              // invalidates getList cache for Item list

export function revalidateDoc(doctype: string, name: string): void {
  revalidateTag(`${doctype}::${name}`)
}

export function revalidateList(doctype: string): void {
  revalidateTag(doctype)
}

// ─── Boot Data ────────────────────────────────────────────────────────────────
// React.cache() memoizes fetchCsrfToken per request.
// 50 Server Components calling getFrappeBootData() = exactly 1 Frappe call.

export const fetchCsrfToken = cache(async (): Promise<string> => {
  const base = resolveBaseUrl()
  try {
    const jar = await cookies()
    const sid = jar.get('sid')?.value
    if (!sid || sid === 'Guest') return 'fetch'

    const res = await fetch(
      `${base}/api/method/frappe.sessions.get_csrf_token`,
      { headers: { Cookie: `sid=${sid}` }, cache: 'no-store', signal: requestSignal() },
    )
    if (!res.ok) return 'fetch'
    const data = await res.json() as { csrf_token?: string }
    return data.csrf_token ?? 'fetch'
  } catch {
    return 'fetch'
  }
})

export async function getFrappeBootData(): Promise<BootData> {
  const reqHeaders = await headers()
  const user       = reqHeaders.get('x-frappe-user') ?? null
  const csrfToken  = await fetchCsrfToken()

  return {
    csrfToken,
    user,
    siteName: process.env.FRAPPE_SITE_NAME ?? '',
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class FrappeApiError extends Error {
  constructor(
    public readonly status:  number,
    public readonly method:  string,
    public readonly details: unknown,
  ) {
    super(`[FrappeNext] ${status} on ${method}`)
    this.name = 'FrappeApiError'
  }
}

export class FrappeAuthError extends FrappeApiError {
  constructor(method: string) {
    super(403, method, 'Session expired or insufficient permissions')
    this.name = 'FrappeAuthError'
  }
}

export class FrappeNotFoundError extends FrappeApiError {
  constructor(method: string) {
    super(404, method, 'Resource not found')
    this.name = 'FrappeNotFoundError'
  }
}
