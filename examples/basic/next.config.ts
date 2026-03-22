import path           from "path";
import type { NextConfig } from "next";

function getFrappeUrl(): string {
  const url =
    process.env.FRAPPE_INTERNAL_URL ??
    process.env.FRAPPE_URL          ??
    "http://127.0.0.1:8000";
  console.log(`[FrappeNext] Proxying Frappe requests → ${url}`);
  return url;
}

const nextConfig: NextConfig = {
  // Required for Docker multi-stage build
  output: "standalone",

  // Compile our local SDK TypeScript source directly
  transpilePackages: ["@frappe-next/core"],

  // Tell Turbopack which directory is the monorepo root
  // Fixes: "Next.js inferred your workspace root" warning
  turbopack: {
    root: path.resolve(__dirname, ".."),   // absolute path → monorepo root
  },

  // Allow LAN access in dev (e.g. http://192.168.1.x:3000 from another device)
  // Add your machine's local IP here if needed
  allowedDevOrigins: ["192.168.1.6"],

  // Proxy browser requests to Frappe:
  //   Local dev  → http://127.0.0.1:8000     (bench)
  //   Docker dev → http://frappe-backend:8000 (container)
  //   Docker prod with Nginx → Nginx intercepts /api/* before Next.js sees it
  async rewrites() {
    const frappe = getFrappeUrl();
    return [
      { source: "/api/method/:path*",   destination: `${frappe}/api/method/:path*`   },
      { source: "/api/resource/:path*", destination: `${frappe}/api/resource/:path*` },
      { source: "/assets/:path*",       destination: `${frappe}/assets/:path*`       },
      { source: "/files/:path*",        destination: `${frappe}/files/:path*`        },
      { source: "/app/:path*",          destination: `${frappe}/app/:path*`          },
    ];
  },
};

export default nextConfig;
