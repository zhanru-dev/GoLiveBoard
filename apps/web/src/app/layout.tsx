import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";

import {
  ERROR_REPORTING_META,
  errorReportingSettings,
} from "@/lib/error-reporting";

import "./globals.css";

// Self-hosted by Next.js at build time: no request to Google from the browser.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "GoLiveBoard", template: "%s · GoLiveBoard" },
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
  // Read at request time, so one image serves every environment.
  const errorReporting = errorReportingSettings();
  return (
    <html lang="en-GB" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        {errorReporting === null ? null : (
          <meta
            name={ERROR_REPORTING_META}
            content={JSON.stringify(errorReporting)}
          />
        )}
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
