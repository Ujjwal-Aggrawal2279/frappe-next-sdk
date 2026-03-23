# @frappe-next/core

**Next.js App Router SDK for Frappe Framework.**
SSR · Server Actions · Middleware · ISR · TypeScript-first.

> **Looking for the CLI?**
> [`frappe-next-bridge`](https://github.com/Ujjwal-Aggrawal2279/frappe-next-bridge) — run `bench add-nextjs` to scaffold a full Next.js project inside any Frappe app in under a minute.

---

## What this is

Frappe has a great REST API. Next.js has great SSR. This SDK is the missing bridge:

| Problem | This SDK |
|---------|----------|
| Server Components can't call Frappe with session | `frappeGet()` / `getDoc()` / `getList()` forward cookies server-side |
| Middleware can't verify Frappe sessions | `createFrappeAuthMiddleware()` — Edge Runtime, zero Node.js APIs |
| Client components need CSRF for mutations | `frappeClientPost()` reads `window.csrf_token` automatically |
| Server Actions need auth without CSRF | API key auth built-in (`token key:secret`) |
| 50 components calling boot = 50 Frappe calls | `React.cache()` deduplicates to exactly 1 call per request |

---

## Install

```bash
npm install @frappe-next/core
# or
pnpm add @frappe-next/core
```

Peer deps: `next >= 15`, `react >= 19`, `react-dom >= 19`

---

## Quick start

### 1. Middleware (`src/proxy.ts`)

```ts
import { createFrappeAuthMiddleware } from "@frappe-next/core/middleware";
import type { NextRequest } from "next/server";

const handler = createFrappeAuthMiddleware({
  loginPath: "/login",
  publicPaths: ["/api/"],   // Frappe API bypasses our auth check
});

export function proxy(request: NextRequest) {
  return handler(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
```

### 2. Layout (`src/app/layout.tsx`)

```tsx
import { getFrappeBootData }  from "@frappe-next/core/server";
import { FrappeNextProvider } from "@frappe-next/core/components";

export default async function RootLayout({ children }) {
  const boot = await getFrappeBootData();   // zero extra Frappe calls — reads middleware headers

  return (
    <html>
      <body>
        <FrappeNextProvider {...boot}>{children}</FrappeNextProvider>
      </body>
    </html>
  );
}
```

### 3. Server Component (SSR + ISR)

```tsx
import { getList } from "@frappe-next/core/server";

export const revalidate = 60;   // ISR: re-render every 60s

export default async function Page() {
  const items = await getList("Item", {
    fields:  ["name", "item_name", "item_group"],
    filters: [["disabled", "=", "0"]],
    limit:   20,
  });

  return <ul>{items.map(i => <li key={i.name}>{i.item_name}</li>)}</ul>;
}
```

### 4. Client Component (mutations)

```tsx
"use client";
import { frappeClientPost } from "@frappe-next/core/client";

async function save() {
  const result = await frappeClientPost("my_app.api.save_item", { name: "TEST-001" });
}
```

### 5. Server Action (mutation with API key)

```ts
"use server";
import { createDoc } from "@frappe-next/core/actions";

export async function createItem(data: { item_name: string }) {
  return createDoc("Item", data);   // uses FRAPPE_API_KEY — no CSRF needed
}
```

---

## Environment variables

```bash
# .env.local
FRAPPE_INTERNAL_URL=http://127.0.0.1:8000   # Docker: http://frappe-backend:8000
FRAPPE_API_KEY=your_key
FRAPPE_API_SECRET=your_secret
FRAPPE_SITE_NAME=site1.localhost
NEXT_PUBLIC_FRAPPE_SITE=site1.localhost
```

---

## API reference

### `@frappe-next/core/server`

| Export | Description |
|--------|-------------|
| `frappeGet<T>(method, params?, options?)` | GET `/api/method/<method>` with session cookie forwarding |
| `frappePost<T>(method, body?, options?)` | POST — prefers API key auth, falls back to session |
| `getDoc<T>(doctype, name, options?)` | Fetch a single document — per-request deduplicated via `React.cache()` |
| `getDocOrNull<T>(doctype, name, options?)` | Same as `getDoc` but returns `null` on 404 |
| `getList<T>(doctype, args?, options?)` | Fetch a filtered list |
| `getCount(doctype, filters?)` | Count matching documents |
| `revalidateDoc(doctype, name)` | Invalidate ISR cache for a document — call from Server Actions after mutations |
| `revalidateList(doctype)` | Invalidate ISR cache for a list |
| `getFrappeBootData()` | Returns `{ user, csrfToken, siteName }` — zero extra Frappe calls |
| `fetchCsrfToken` | `React.cache()` memoized CSRF token fetcher |
| `FrappeApiError` / `FrappeAuthError` / `FrappeNotFoundError` | Typed error classes |

### `@frappe-next/core/middleware`

| Export | Description |
|--------|-------------|
| `createFrappeAuthMiddleware(config)` | Returns a Next.js `proxy` function — Edge Runtime compatible |

### `@frappe-next/core/client`

| Export | Description |
|--------|-------------|
| `frappeClientGet<T>(method, params?)` | Browser fetch — credentials: include, no CSRF needed |
| `frappeClientPost<T>(method, body?)` | Browser fetch — reads `window.csrf_token` automatically |
| `useFrappeRouter()` | Smart router — `navigate(path)` auto-picks Next.js router vs `window.location` based on path ownership. Also exposes `toDesk(module?)` and `toDoc(doctype, name?)` |

### `@frappe-next/core/actions`

| Export | Description |
|--------|-------------|
| `callMethod<T>(method, body?)` | Call any whitelisted Frappe method |
| `createDoc<T>(doctype, doc)` | POST `/api/resource/<doctype>` |
| `updateDoc<T>(doctype, name, updates)` | PUT `/api/resource/<doctype>/<name>` |
| `deleteDoc(doctype, name)` | DELETE `/api/resource/<doctype>/<name>` |

### `@frappe-next/core/components`

| Export | Description |
|--------|-------------|
| `FrappeNextProvider` | Injects `window.csrf_token`, provides context |
| `useFrappeNext()` | Returns `{ user, csrfToken, siteName, hydrated }` |

---

## Examples

See [`examples/basic/`](./examples/basic/) for a full working app with login, SSR list page, and ISR.

---

## License

MIT © frappe-next contributors
