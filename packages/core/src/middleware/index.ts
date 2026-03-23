// ─── Edge Runtime Compatible ───────────────────────────────────────────────────
// Zero Node.js-only APIs. No Buffer, no fs, no crypto module.
// Uses only: fetch, Headers, AbortController, URL, NextRequest, NextResponse.

import { NextRequest, NextResponse } from 'next/server'

export interface FrappeMiddlewareConfig {
  frappeUrl?:        string
  loginPath?:        string
  publicPaths?:      string[]
  sessionTimeoutMs?: number
}

const ALWAYS_SKIP = [
  '/_next/',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
]

// ─── Factory ──────────────────────────────────────────────────────────────────
// Returns a Next.js middleware function.
// Call once at module level in middleware.ts:
//   export default createFrappeAuthMiddleware({ loginPath: '/login' })

export function createFrappeAuthMiddleware(cfg: FrappeMiddlewareConfig = {}) {
  const {
    loginPath        = '/login',
    publicPaths      = [],
    sessionTimeoutMs = 4000,
  } = cfg

  // Resolve once at server startup.
  // process.env IS available in Next.js Edge Runtime.
  const frappeUrl =
    cfg.frappeUrl               ??
    process.env.FRAPPE_INTERNAL_URL ??
    process.env.FRAPPE_URL          ??
    'http://127.0.0.1:8000'

  const siteName =
    process.env.FRAPPE_SITE_NAME ??
    process.env.NEXT_PUBLIC_FRAPPE_SITE ??
    'site1.localhost'

  const skip = [loginPath, ...ALWAYS_SKIP, ...publicPaths]

  return async function middleware(req: NextRequest): Promise<NextResponse> {
    const { pathname } = req.nextUrl

    // ── 1. Skip public / static paths ─────────────────────────────────────
    if (skip.some((p) => pathname.startsWith(p))) {
      return NextResponse.next()
    }

    // ── 1b. Root-level Frappe ?cmd= params (e.g. /?cmd=web_logout) ────────
    // The catch-all [...frappe] requires at least one path segment, so root
    // Frappe commands never reach it. Rewrite to /api/?cmd=... which nginx
    // (prod) or the dev proxy routes directly to Frappe.
    if (pathname === '/' && req.nextUrl.searchParams.has('cmd')) {
      const target = req.nextUrl.clone()
      target.pathname = '/api/'
      return NextResponse.redirect(target)
    }

    // ── 2. No session cookie → instant redirect, no Frappe call ──────────
    const sid = req.cookies.get('sid')?.value
    if (!sid || sid === 'Guest') {
      return loginRedirect(req, loginPath, 'no_session')
    }

    // ── 3. Verify session against Frappe ──────────────────────────────────
    const user = await verifySession(sid, frappeUrl, siteName, sessionTimeoutMs)

    if (!user) {
      const res = loginRedirect(req, loginPath, 'session_invalid')
      res.cookies.delete('sid')
      return res
    }

    // ── 4. Inject user into REQUEST headers ───────────────────────────────
    // NextResponse.next({ request: { headers } }) is the correct Next.js API
    // to pass data from middleware into downstream Server Components.
    // Server Components read it with: (await headers()).get('x-frappe-user')
    const mutated = new Headers(req.headers)
    mutated.set('x-frappe-user', user)

    return NextResponse.next({ request: { headers: mutated } })
  }
}

// ─── Session Verifier ─────────────────────────────────────────────────────────

async function verifySession(
  sid:       string,
  frappeUrl: string,
  siteName:  string,
  timeoutMs: number,
): Promise<string | null> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch(
      `${frappeUrl}/api/method/frappe.auth.get_logged_user`,
      {
        method:  'GET',
        headers: {
          Cookie:                `sid=${sid}`,
          Accept:                'application/json',
          'X-Frappe-Site-Name': siteName,
        },
        cache:  'no-store',
        signal: ctrl.signal,
      },
    )

    clearTimeout(timer)
    if (!res.ok) return null

    const { message } = await res.json() as { message: string }
    return message && message !== 'Guest' ? message : null
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`[FrappeNext] Session verify timed out after ${timeoutMs}ms`)
    }
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loginRedirect(
  req:       NextRequest,
  loginPath: string,
  reason:    string,
): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = loginPath
  url.searchParams.set('next',   req.nextUrl.pathname)
  url.searchParams.set('reason', reason)
  return NextResponse.redirect(url)
}
