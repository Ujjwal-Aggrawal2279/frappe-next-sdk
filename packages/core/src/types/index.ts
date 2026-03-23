// ─── Frappe Wire Types ─────────────────────────────────────────────────────────

export interface FrappeEnvelope<T> {
  message:           T
  exc_type?:         string
  exception?:        string
  _server_messages?: string
}

export interface FrappeDoc {
  name:        string
  owner:       string
  creation:    string
  modified:    string
  modified_by: string
  doctype:     string
  docstatus:   0 | 1 | 2
  idx:         number
  [key: string]: unknown
}

export type FrappeParams = Record<string, string | number | boolean | null | undefined>

// ─── Typed filter operators ────────────────────────────────────────────────────
// Exhaustive list of operators Frappe's query engine accepts.
// Using a typed operator catches typos at compile time ("==" instead of "=").
export type FrappeOperator =
  | '=' | '!=' | '<' | '>' | '<=' | '>='
  | 'like' | 'not like'
  | 'in' | 'not in'
  | 'between'
  | 'is' | 'is not'
  | 'ancestors of' | 'descendants of'
  | 'not ancestors of' | 'not descendants of'
  | 'timespan'

// Frappe filter: [fieldname, operator, value]
export type FrappeFilter = [string, FrappeOperator, unknown]

export interface GetListArgs {
  fields?:      readonly string[]
  filters?:     readonly FrappeFilter[]
  or_filters?:  readonly FrappeFilter[]
  limit?:       number
  limit_start?: number
  order_by?:    string
}

// Next.js extends fetch() with a `next` property for ISR/cache control.
// We define it ourselves so this package doesn't depend on Next.js types.
export interface NextCacheConfig {
  revalidate?: number | false
  tags?:       string[]
}

export interface FrappeFetchOptions {
  next?:        NextCacheConfig
  headers?:     Record<string, string>
  skipSession?: boolean
}

export interface BootData {
  csrfToken: string
  user:      string | null
  siteName:  string
}

export type ActionOk<T> = { ok: true;  data: T }
export type ActionErr   = { ok: false; error: string; status?: number }
export type ActionResult<T> = ActionOk<T> | ActionErr
