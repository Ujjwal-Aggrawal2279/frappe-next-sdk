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

export async function submitDoc(
  doctype: string,
  name:    string,
): Promise<ActionResult<{ name: string; docstatus: 1 }>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/method/frappe.client.submit`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify({ doc: { doctype, name, docstatus: 1 } }),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { message } = await res.json() as { message: { name: string; docstatus: 1 } }
    return { ok: true, data: message }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function cancelDoc(
  doctype: string,
  name:    string,
): Promise<ActionResult<{ name: string; docstatus: 2 }>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/method/frappe.client.cancel`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify({ doctype, name }),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { message } = await res.json() as { message: { name: string; docstatus: 2 } }
    return { ok: true, data: message }
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

// ── Bulk Insert ───────────────────────────────────────────────────────────────
// Insert up to 200 documents in one round-trip.
// Frappe validates and saves each doc server-side — triggers all hooks.
//
// Usage:
//   const result = await bulkInsert<Item>([
//     { item_code: "ITEM-001", item_name: "Widget" },
//     { item_code: "ITEM-002", item_name: "Gadget" },
//   ])

export async function bulkInsert<T extends Record<string, unknown>>(
  docs: Partial<T & { doctype: string }>[],
): Promise<ActionResult<T[]>> {
  const base = resolveBaseUrl()
  if (docs.length > 200) {
    return { ok: false, error: 'bulkInsert: Frappe limits insert_many to 200 documents per call.' }
  }
  try {
    const res = await fetch(`${base}/api/method/frappe.client.insert_many`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify({ docs }),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { message } = await res.json() as { message: T[] }
    return { ok: true, data: message }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Rename Document ───────────────────────────────────────────────────────────
// Rename (or merge) a document. Frappe updates all links automatically.
//
// Usage:
//   await renameDoc("Customer", "Old Name", "New Name")
//   await renameDoc("Customer", "Duplicate", "Original", { merge: true })

export async function renameDoc(
  doctype:  string,
  oldName:  string,
  newName:  string,
  options?: { merge?: boolean },
): Promise<ActionResult<string>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/method/frappe.client.rename_doc`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify({
        doctype,
        old_name: oldName,
        new_name: newName,
        merge:    options?.merge ? 1 : 0,
      }),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { message } = await res.json() as { message: string }
    return { ok: true, data: message }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Document Assignment ───────────────────────────────────────────────────────
// Assign a document to one or more users.
// Shows up in the assignee's task list and triggers notification.
//
// Usage:
//   await assignTo("Sales Order", "SO-0001", ["user@example.com"])
//   await removeAssignment("Sales Order", "SO-0001", "user@example.com")

export async function assignTo(
  doctype:  string,
  name:     string,
  users:    string[],
  options?: { description?: string; dueDate?: string; notify?: boolean },
): Promise<ActionResult<void>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/method/frappe.desk.form.assign_to.add_multiple`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify({
        args: JSON.stringify({
          doctype,
          name,
          assign_to:   users,
          description: options?.description ?? '',
          date:        options?.dueDate ?? '',
          notify:      options?.notify ? 1 : 0,
        }),
      }),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function removeAssignment(
  doctype:   string,
  name:      string,
  assignedTo: string,
): Promise<ActionResult<void>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(`${base}/api/method/frappe.desk.form.assign_to.remove`, {
      method:  'POST',
      headers: buildApiKeyHeaders(),
      body:    JSON.stringify({ doctype, name, assign_to: assignedTo }),
    })
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Document Info (Timeline, Comments, Shares) ────────────────────────────────
// Fetch the full metadata sidebar for a document — comments, assignments,
// version history, shares, and energy points.
// Use in rich document view pages.

export interface DocInfo {
  comments:       unknown[]
  shared:         unknown[]
  assignments:    unknown[]
  attachments:    unknown[]
  versions:       unknown[]
  energy_point_logs: unknown[]
  total_comments: number
}

export async function getDocInfo(
  doctype: string,
  name:    string,
): Promise<ActionResult<DocInfo>> {
  const base = resolveBaseUrl()
  try {
    const res = await fetch(
      `${base}/api/method/frappe.desk.form.load.get_docinfo?` +
        new URLSearchParams({ doctype, name }).toString(),
      { headers: buildApiKeyHeaders() },
    )
    if (!res.ok) return { ok: false, error: await parseError(res), status: res.status }
    const { message } = await res.json() as { message: DocInfo }
    return { ok: true, data: message }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
