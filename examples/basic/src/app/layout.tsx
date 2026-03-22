import type { Metadata } from "next";
import { getFrappeBootData }  from "@frappe-next/core/server";
import { FrappeNextProvider } from "@frappe-next/core/components";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frappe Next Bridge",
  description: "Next.js 15 + Frappe v15",
};

// Server Component — runs on Node.js.
// getFrappeBootData() reads x-frappe-user from middleware headers (0 extra Frappe calls)
// and fetches csrf_token once via React.cache() memoization.
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const boot = await getFrappeBootData();

  return (
    <html lang="en">
      <body>
        {/* FrappeNextProvider is 'use client' — injects window.csrf_token */}
        <FrappeNextProvider
          csrfToken={boot.csrfToken}
          siteName={boot.siteName}
          user={boot.user}
        >
          {children}
        </FrappeNextProvider>
      </body>
    </html>
  );
}
