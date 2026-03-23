# @frappe-next/core

[![npm version](https://img.shields.io/npm/v/@frappe-next/core)](https://www.npmjs.com/package/@frappe-next/core)
[![license](https://img.shields.io/npm/l/@frappe-next/core)](./LICENSE)

Next.js App Router SDK for Frappe Framework — SSR-first data fetching, Server Actions, Edge middleware, and browser utilities that eliminate client-side waterfalls when building on Frappe/ERPNext backends.

---

## The Problem

Frappe's existing React SDK (`frappe-react-sdk`) was built for CSR. Every page load triggers a client-side session check, a CSRF token fetch, then the actual data fetch — three sequential round trips before anything renders. With Next.js App Router you can run all of that on the server, stream HTML to the browser immediately, and keep sensitive API credentials out of the client bundle entirely.

`@frappe-next/core` gives you typed, cache-aware server helpers, Server Actions backed by API key auth, Edge-compatible auth middleware, and thin browser utilities for the interactions that genuinely need the client.

---

## Install

```bash
npm i @frappe-next/core
```

---

## Requirements

| Peer dependency | Version |
|---|---|
| `next` | >= 15.0.0 |
| `react` | >= 19.0.0 |
| `react-dom` | >= 19.0.0 |
| Frappe Framework | v15 / v16 |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FRAPPE_INTERNAL_URL` | Docker/prod | Internal container URL, e.g. `http://frappe-backend:8000`. Takes priority over `FRAPPE_URL`. |
| `FRAPPE_URL` | Optional | Public Frappe URL. Used when `FRAPPE_INTERNAL_URL` is not set. |
| `FRAPPE_SITE_NAME` | Recommended | Frappe site name forwarded as `X-Frappe-Site-Name`. Falls back to `NEXT_PUBLIC_FRAPPE_SITE`, then `site1.localhost`. |
| `FRAPPE_API_KEY` | Actions | API key from Frappe Desk → Settings → Users → API Access. |
| `FRAPPE_API_SECRET` | Actions | API secret paired with `FRAPPE_API_KEY`. |
| `FRAPPE_REQUEST_TIMEOUT` | Optional | Timeout in milliseconds for server-side Frappe requests. Default: `8000`. |
| `NEXT_PUBLIC_FRAPPE_SITE` | Optional | Public site name for client-accessible config. |

URL resolution priority (server-side): `FRAPPE_INTERNAL_URL` → `FRAPPE_URL` → `http://127.0.0.1:8000`

---

## Quick Start

### 1. Middleware — auth guard and session injection

Create `src/middleware.ts`:

```typescript
import { createFrappeAuthMiddleware } from '@frappe-next/core/middleware'

export default createFrappeAuthMiddleware({
  loginPath:   '/login',
  publicPaths: ['/about', '/pricing'],
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

The middleware verifies the Frappe session cookie on every protected request and injects the authenticated username as `x-frappe-user` into the downstream request headers. Server Components can read it without an extra Frappe call.

### 2. Root layout — boot data and provider

```typescript
// src/app/layout.tsx
import { getFrappeBootData } from '@frappe-next/core/server'
import { FrappeNextProvider } from '@frappe-next/core/components'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const boot = await getFrappeBootData()

  return (
    <html>
      <body>
        <FrappeNextProvider {...boot}>
          {children}
        </FrappeNextProvider>
      </body>
    </html>
  )
}
```

`getFrappeBootData()` reads the user from the middleware-injected header and fetches the CSRF token — once per request, memoised with `React.cache()`. `FrappeNextProvider` makes the token available to client-side fetchers via `window.csrf_token`.

---

## API Reference

### `@frappe-next/core/server`

Server-only utilities for Server Components, `generateMetadata`, and `generateStaticParams`. The module enforces this boundary with `import 'server-only'`.

#### `getDoc<T>(doctype, name, options?)`

Fetches a single Frappe document. Deduplicated per request via `React.cache()` — ten Server Components calling `getDoc('Item', 'ITEM-001')` produce exactly one network request. Tagged for Next.js ISR cache invalidation.

```typescript
import { getDoc } from '@frappe-next/core/server'

interface Item {
  name:        string
  item_name:   string
  description: string
  standard_rate: number
}

// In a Server Component:
const item = await getDoc<Item>('Item', 'ITEM-001')
```

Custom ISR configuration:

```typescript
const item = await getDoc<Item>('Item', 'ITEM-001', {
  next: { revalidate: 60 }, // revalidate every 60 s
})
```

#### `getDocOrNull<T>(doctype, name, options?)`

Same as `getDoc` but returns `null` on 404 instead of throwing. Use for optional documents without a try/catch block.

```typescript
const draft = await getDocOrNull<SalesOrder>('Sales Order', params.name)
if (!draft) notFound()
```

#### `getList<T>(doctype, args?, options?)`

Fetches a list of documents. Tagged with the doctype name for ISR invalidation.

```typescript
import { getList } from '@frappe-next/core/server'
import type { FrappeFilter } from '@frappe-next/core/types'

const orders = await getList<SalesOrder>('Sales Order', {
  fields:   ['name', 'customer', 'grand_total', 'status'],
  filters:  [['status', '=', 'Submitted']],
  order_by: 'creation desc',
  limit:    50,
})
```

`GetListArgs` options:

| Option | Type | Default |
|---|---|---|
| `fields` | `string[]` | `['name', 'modified']` |
| `filters` | `FrappeFilter[]` | `[]` |
| `or_filters` | `FrappeFilter[]` | `[]` |
| `limit` | `number` | `20` |
| `limit_start` | `number` | `0` |
| `order_by` | `string` | `'modified desc'` |

#### `getCount(doctype, filters?, options?)`

Returns the document count matching the given filters.

```typescript
const openCount = await getCount('Task', [['status', '=', 'Open']])
```

#### `frappeGet<T>(method, params?, options?)`

Low-level GET wrapper for any whitelisted Frappe method. Use when `getDoc`/`getList` do not cover your endpoint.

```typescript
import { frappeGet } from '@frappe-next/core/server'

const result = await frappeGet<{ items: string[] }>(
  'myapp.api.get_dashboard_data',
  { warehouse: 'Main' },
  { next: { tags: ['dashboard'], revalidate: 30 } },
)
```

#### `frappePost<T>(method, body?, options?)`

Low-level POST wrapper. Prefers API key authentication for server-to-server calls; falls back to forwarding the session cookie.

```typescript
import { frappePost } from '@frappe-next/core/server'

await frappePost('myapp.api.process_batch', { batch_id: 'BATCH-001' })
```

#### `getFrappeBootData()`

Returns `{ csrfToken, user, siteName }`. Reads the authenticated user from the `x-frappe-user` header set by middleware and fetches the CSRF token (once per request via `React.cache()`).

```typescript
import { getFrappeBootData } from '@frappe-next/core/server'

const { user, csrfToken, siteName } = await getFrappeBootData()
```

#### `revalidateDoc(doctype, name)` / `revalidateList(doctype)`

Invalidate the Next.js ISR cache after mutations. Call from Server Actions alongside write operations.

```typescript
import { revalidateDoc, revalidateList } from '@frappe-next/core/server'

revalidateDoc('Item', 'ITEM-001')  // invalidates getDoc cache for this document
revalidateList('Item')             // invalidates getList cache for Item
```

#### Error Classes

All server helpers throw typed errors you can catch and handle specifically:

```typescript
import {
  FrappeApiError,
  FrappeAuthError,
  FrappeNotFoundError,
} from '@frappe-next/core/server'

try {
  const doc = await getDoc<Item>('Item', name)
} catch (err) {
  if (err instanceof FrappeNotFoundError) {
    notFound()             // Next.js 404 page
  }
  if (err instanceof FrappeAuthError) {
    redirect('/login')     // session expired
  }
  throw err                // unexpected — let the error boundary handle it
}
```

| Class | HTTP Status | When thrown |
|---|---|---|
| `FrappeNotFoundError` | 404 | Document or method not found |
| `FrappeAuthError` | 403 | Session expired or insufficient permissions |
| `FrappeApiError` | any | Base class — all other non-OK responses |

All three extend `Error` and carry `.status`, `.method`, and `.details` properties.

---

### `@frappe-next/core/actions`

Helpers for use inside your own Server Actions. This module is `server-only` and uses API key authentication — **no CSRF token required**. Do not put `'use server'` in this module; add it in your own `actions.ts` files.

```typescript
// src/app/actions.ts
'use server'

import { createDoc, updateDoc, deleteDoc, callMethod } from '@frappe-next/core/actions'
import { revalidateDoc, revalidateList } from '@frappe-next/core/server'
```

#### `callMethod<T>(method, body?)`

Calls any whitelisted Frappe API method.

```typescript
const result = await callMethod<{ pdf_url: string }>(
  'myapp.api.generate_pdf',
  { doctype: 'Sales Invoice', name: 'SINV-0001' },
)

if (!result.ok) {
  console.error(result.error)
  return
}
console.log(result.data.pdf_url)
```

#### `createDoc<T>(doctype, doc)`

Creates a new document via `POST /api/resource/{doctype}`.

```typescript
const result = await createDoc<Task>('Task', {
  subject:  'Review proposal',
  assigned_to: 'user@example.com',
  priority: 'High',
})

if (result.ok) {
  revalidateList('Task')
  return result.data.name  // e.g. "TASK-00042"
}
```

#### `updateDoc<T>(doctype, name, updates)`

Updates an existing document via `PUT /api/resource/{doctype}/{name}`.

```typescript
const result = await updateDoc<Task>('Task', 'TASK-00042', {
  status: 'Completed',
})

if (result.ok) {
  revalidateDoc('Task', 'TASK-00042')
}
```

#### `deleteDoc(doctype, name)`

Deletes a document via `DELETE /api/resource/{doctype}/{name}`.

```typescript
const result = await deleteDoc('Task', 'TASK-00042')

if (result.ok) {
  revalidateList('Task')
}
```

All action helpers return `ActionResult<T>`, a discriminated union:

```typescript
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string; status?: number }
```

---

### `@frappe-next/core/client`

Browser-only utilities marked with `'use client'`. Safe to import in Client Components.

#### `frappeClientGet<T>(method, params?)`

Fetches from a Frappe method using the browser's session cookie. Uses relative URLs so no CORS configuration is required.

```typescript
'use client'
import { frappeClientGet } from '@frappe-next/core/client'

const suggestions = await frappeClientGet<string[]>(
  'frappe.desk.search.search_link',
  { txt: query, doctype: 'Customer', ignore_user_permissions: 0 },
)
```

#### `frappeClientPost<T>(method, body?)`

Posts to a Frappe method from the browser. Reads the CSRF token from `window.csrf_token` (injected by `FrappeNextProvider`) or falls back to the `csrf_token` cookie.

```typescript
'use client'
import { frappeClientPost } from '@frappe-next/core/client'

const result = await frappeClientPost<{ message: string }>(
  'myapp.api.submit_feedback',
  { rating: 5, comment: 'Great service' },
)
```

#### `frappeLogin(usr, pwd)`

Authenticates against Frappe and returns the full login response including `home_page` for post-login redirect.

```typescript
'use client'
import { frappeLogin } from '@frappe-next/core/client'

async function handleSubmit(usr: string, pwd: string) {
  const res = await frappeLogin(usr, pwd)
  // res.message === 'Logged In'
  // res.home_page === '/dashboard' (or whatever Frappe returns)
  window.location.href = res.home_page ?? '/'
}
```

`FrappeLoginResponse`:
```typescript
interface FrappeLoginResponse {
  message:    string   // "Logged In" | "No App" | etc.
  home_page?: string   // post-login redirect target
  full_name?: string
}
```

#### `useFrappeRouter()`

A smart router hook that routes navigation to Next.js client-side navigation for your app's pages and falls back to `window.location.href` for Frappe-owned paths (`/app`, `/api`, `/files`, `/print`, etc.).

```typescript
'use client'
import { useFrappeRouter } from '@frappe-next/core/client'

function Nav() {
  const { navigate, toDesk, toDoc } = useFrappeRouter()

  return (
    <>
      {/* SPA navigation — no page reload */}
      <button onClick={() => navigate('/dashboard')}>Dashboard</button>

      {/* Full navigation to Frappe Desk */}
      <button onClick={() => toDesk()}>Open Desk</button>
      <button onClick={() => toDesk('selling')}>Selling Module</button>

      {/* Navigate to a specific Frappe document */}
      <button onClick={() => toDoc('Sales Order', 'SO-00142')}>View Order</button>
    </>
  )
}
```

Frappe-owned path prefixes: `/app`, `/api`, `/assets`, `/files`, `/private`, `/me`, `/update-password`, `/print`, `/list`, `/form`, `/tree`, `/report`, `/dashboard`.

---

### `@frappe-next/core/middleware`

#### `createFrappeAuthMiddleware(config?)`

Factory that returns a Next.js-compatible middleware function. Runs at Edge Runtime — zero Node.js-only APIs.

```typescript
// src/middleware.ts
import { createFrappeAuthMiddleware } from '@frappe-next/core/middleware'

export default createFrappeAuthMiddleware({
  loginPath:        '/login',
  publicPaths:      ['/about', '/pricing', '/api/webhook'],
  sessionTimeoutMs: 4000,
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

`FrappeMiddlewareConfig`:

| Option | Type | Default | Description |
|---|---|---|---|
| `frappeUrl` | `string` | env fallback | Override Frappe URL. Defaults to `FRAPPE_INTERNAL_URL` → `FRAPPE_URL` → `http://127.0.0.1:8000` |
| `loginPath` | `string` | `'/login'` | Path to redirect unauthenticated requests to |
| `publicPaths` | `string[]` | `[]` | Path prefixes that bypass session verification |
| `sessionTimeoutMs` | `number` | `4000` | Abort timeout for the Frappe session check |

What the middleware does on each request:

1. **Static assets** (`/_next/`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`) and paths in `publicPaths` pass through immediately — no Frappe call.
2. If no `sid` cookie is present or it equals `'Guest'`, the request is redirected to `loginPath?next={original_path}&reason=no_session`.
3. The `sid` is verified against `frappe.auth.get_logged_user`. If the session is invalid, the `sid` cookie is cleared and the request is redirected.
4. On success, the authenticated username is injected as `x-frappe-user` in the request headers for downstream Server Components to read.

---

### `@frappe-next/core/components`

#### `FrappeNextProvider`

A Client Component that provides Frappe boot data (CSRF token, current user, site name) to the React tree and injects `window.csrf_token` for client-side fetchers.

```typescript
// src/app/layout.tsx
import { getFrappeBootData } from '@frappe-next/core/server'
import { FrappeNextProvider } from '@frappe-next/core/components'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const boot = await getFrappeBootData()

  return (
    <html>
      <body>
        <FrappeNextProvider {...boot}>
          {children}
        </FrappeNextProvider>
      </body>
    </html>
  )
}
```

Props (`BootData`):

| Prop | Type | Description |
|---|---|---|
| `csrfToken` | `string` | Frappe CSRF token. Injected as `window.csrf_token`. |
| `user` | `string \| null` | Authenticated user email, or `null` for guests. |
| `siteName` | `string` | Frappe site name from `FRAPPE_SITE_NAME`. |

#### `useFrappeNext()`

Access boot data from any Client Component in the tree.

```typescript
'use client'
import { useFrappeNext } from '@frappe-next/core/components'

function UserBadge() {
  const { user, hydrated } = useFrappeNext()
  if (!hydrated) return null
  return <span>{user ?? 'Guest'}</span>
}
```

Returns `{ csrfToken, user, siteName, hydrated }` where `hydrated` is `false` during SSR and flips to `true` after the first client effect.

---

### `@frappe-next/core/types`

Pure TypeScript interfaces — zero runtime cost.

```typescript
import type {
  FrappeFilter,
  FrappeDoc,
  GetListArgs,
  FrappeFetchOptions,
  FrappeEnvelope,
  FrappeParams,
  BootData,
  ActionResult,
  ActionOk,
  ActionErr,
  NextCacheConfig,
} from '@frappe-next/core/types'
```

Key types:

```typescript
// Frappe filter tuple: [field, operator, value]
type FrappeFilter = [string, string, unknown]

// Examples:
const filters: FrappeFilter[] = [
  ['status',     '=',       'Submitted'],
  ['grand_total','>=',      1000],
  ['customer',   'in',      ['CUST-001', 'CUST-002']],
  ['name',       'like',    'SO-%'],
]

// Base Frappe document fields (extend with your own)
interface FrappeDoc {
  name:        string
  owner:       string
  creation:    string
  modified:    string
  modified_by: string
  doctype:     string
  docstatus:   0 | 1 | 2   // draft | submitted | cancelled
  idx:         number
  [key: string]: unknown
}

// ISR / cache control passed to fetch's `next` option
interface NextCacheConfig {
  revalidate?: number | false
  tags?:       string[]
}

// Options accepted by frappeGet, getDoc, getList, etc.
interface FrappeFetchOptions {
  next?:        NextCacheConfig
  headers?:     Record<string, string>
  skipSession?: boolean          // omit cookie forwarding (useful for public data)
}

// Discriminated union returned by all action helpers
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string; status?: number }
```

---

## Architecture Overview

```
Request
  │
  ├── Edge Middleware (createFrappeAuthMiddleware)
  │     Verifies sid cookie against Frappe
  │     Injects x-frappe-user header
  │
  └── Next.js Server (Node.js runtime)
        │
        ├── Server Components
        │     getDoc / getList / getCount / frappeGet
        │     React.cache() deduplication per request
        │     Next.js ISR tags for cache invalidation
        │
        ├── Server Actions (your actions.ts adds 'use server')
        │     createDoc / updateDoc / deleteDoc / callMethod
        │     API key auth — no CSRF, no cookie forwarding
        │     revalidateDoc / revalidateList after mutations
        │
        └── Client Components
              frappeClientGet / frappeClientPost
              frappeLogin
              useFrappeRouter
              useFrappeNext
```

---

## ISR Cache Invalidation Pattern

Server helpers automatically apply Next.js cache tags:

| Helper | Tags applied |
|---|---|
| `getDoc(doctype, name)` | `${doctype}::${name}` |
| `getList(doctype, ...)` | `${doctype}` |

After a mutation in a Server Action:

```typescript
'use server'
import { updateDoc } from '@frappe-next/core/actions'
import { revalidateDoc, revalidateList } from '@frappe-next/core/server'

export async function submitOrder(name: string) {
  const result = await updateDoc('Sales Order', name, { status: 'Submitted' })
  if (result.ok) {
    revalidateDoc('Sales Order', name)  // bust this document's ISR cache
    revalidateList('Sales Order')       // bust any list pages showing this doctype
  }
  return result
}
```

---

## vs. frappe-react-sdk

| | `frappe-react-sdk` | `@frappe-next/core` |
|---|---|---|
| Architecture | CSR, SWR hooks | SSR-first, Server Components |
| Auth flow | Client-side session check on mount | Edge middleware — verified before render |
| Data fetching | Client waterfall (session → CSRF → data) | Server Component — one render, no waterfall |
| CSRF | Managed by client hooks | Injected by `FrappeNextProvider`, auto-read |
| Caching | SWR in-memory | Next.js ISR with tag-based invalidation |
| Bundle impact | Ships hooks and SWR to the client | Server code never ships to the browser |
| Mutations | Client-side with CSRF token | Server Actions with API key — no CSRF needed |
| App Router | Not supported | Native |
| TypeScript | Partial | Full |

---

## License

MIT — see [LICENSE](./LICENSE).
