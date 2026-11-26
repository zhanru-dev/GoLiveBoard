"use client";

import { RouteError } from "@/components/route-error";

import "./globals.css";

/**
 * When the root layout itself fails, this replaces it (Next.js
 * `global-error`), so it brings its own document and styles.
 */
export default function GlobalError(props: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en-GB">
      <body className="mx-auto max-w-2xl px-4 font-sans antialiased">
        <title>Something went wrong · GoLiveBoard</title>
        <RouteError {...props} />
      </body>
    </html>
  );
}
