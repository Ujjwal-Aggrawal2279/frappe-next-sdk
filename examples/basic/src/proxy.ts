import { createFrappeAuthMiddleware } from "@frappe-next/core/middleware";
import type { NextRequest }           from "next/server";

// Next.js 16: file is proxy.ts, named export must be `proxy` (or default)
const handler = createFrappeAuthMiddleware({
  loginPath: "/login",
  publicPaths: [
    "/api/",      // ALL Frappe API calls bypass our auth check — Frappe handles its own auth
                  // Without this: POST /api/method/login gets intercepted → 307 → HTML → JSON parse error
  ],
  sessionTimeoutMs: 4000,
});

export function proxy(request: NextRequest) {
  return handler(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp)).*)",
  ],
};
