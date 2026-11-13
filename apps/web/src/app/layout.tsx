import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

// Self-hosted by Next.js at build time: no request to Google from the browser.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "OpsPilot", template: "%s · OpsPilot" },
  description:
    "Launch control for online events: know when an event is ready to go live, and keep it under control while it runs.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Render every page per request: the Content Security Policy nonce
  // (src/proxy.ts) is new each time, and a page prerendered at build time
  // could not carry it.
  await connection();
  return (
    <html lang="en-GB" className={geist.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
