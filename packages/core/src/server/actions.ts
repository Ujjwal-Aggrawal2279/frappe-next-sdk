// NO 'use server' here — this is a utility library.
// Your app's own src/app/actions.ts adds 'use server' and calls these helpers.
import 'server-only'
import type { ActionResult } from '../types'

function resolveBaseUrl(): string {
  return (
    process.env.FRAPPE_INTERNAL_URL ??
    process.env.FRAPPE_URL          ??
    'http://127.0.0.1:8000'
  )
}

function buildApiKeyHeaders(): Record<string, string> {
  const key    = process.env.FRAPPE_API_KEY
  const secret = process.env.FRAPPE_API_SECRET
  if (!key || !secret) {
    throw new Error(
      '[FrappeNext] FRAPPE_API_KEY and FRAPPE_API_SECRET required.\n' +
      'Frappe Desk → Settings → Users → <user> → API Access → Generate Keys',
    )
  }
  return {
    'Authorization': `token ${key}:${secret}`,
    'Content-Type':  'application/json',
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const b = await res.json() as Record<string, unknown>
    return String(b['exception'] ?? b['exc_type'] ?? `HTTP ${res.status}`)
  } catch {
    return `HTTP ${res.status}`
  }
}

// ── Generic whitelisted method call ──────────────────────────────────────────
export async function callMethod<T>(
  method: string,
  body?:  Record<string, unknown>,
): Promise<ActionResult<T>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/method/${method}`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify(body ?? {}),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { message } = await res.json() as { message: T }
    return { ok: true, data: message }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── REST resource helpers ─────────────────────────────────────────────────────
export async function createDoc<T extends Record<string, unknown>>(
  doctype: string,
  doc:     Partial<T>,
): Promise<ActionResult<T>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/resource/${doctype}`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify(doc),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { data } = await res.json() as { data: T }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function updateDoc<T extends Record<string, unknown>>(
  doctype: string,
  name:    string,
  updates: Partial<T>,
): Promise<ActionResult<T>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(
      `${base}/api/resource/${doctype}/${encodeURIComponent(name)}`,
      { method: 'PUT', headers: buildApiKeyHeaders(), body: JSON.stringify(updates) },
    )
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { data } = await res.json() as { data: T }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function deleteDoc(
  doctype: string,
  name:    string,
): Promise<ActionResult<{ message: string }>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(
      `${base}/api/resource/${doctype}/${encodeURIComponent(name)}`,
      { method: 'DELETE', headers: buildApiKeyHeaders() },
    )
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    return { ok: true, data: { message: 'Deleted' } }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
