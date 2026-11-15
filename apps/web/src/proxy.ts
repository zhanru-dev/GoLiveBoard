import { type NextRequest, NextResponse } from "next/server";

import {
  errorReportingOrigin,
  errorReportingSettings,
} from "./lib/error-reporting";

/**
 * A strict Content Security Policy (docs/02, section 7.1). Scripts run only if
 * they carry this request's random nonce, so a script injected through an XSS
 * bug does not run. Next.js reads the nonce from the request header and adds
 * it to its own scripts; pages are therefore rendered per request.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV === "development";
  const storage = storageOrigin();
  const errors = errorReportingOrigin(errorReportingSettings());
  const reporting = errors === null ? "" : ` ${errors}`;
  // The watch page plays the event's stream, from wherever its Manager
  // hosts it (any HTTPS origin): hls.js fetches the playlist and segments
  // and hands them to the video element as a blob. Every other page keeps
  // the narrow policy.
  const watching = WATCH_PAGE.test(request.nextUrl.pathname);
  const streams = watching ? " https:" : "";
  const policy = [
    "default-src 'self'",
    // 'strict-dynamic' lets the trusted scripts load the chunks they need.
    // Development needs eval for React's fast refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // React and Radix set inline styles (positions of menus, for example).
    "style-src 'self' 'unsafe-inline'",
    // Holding slates are shown from object storage with presigned links…
    `img-src 'self' data: blob:${storage}`,
    "font-src 'self'",
    // …and uploaded straight to it. Errors are reported to Sentry when it is
    // configured. Development adds the WebSocket used for hot reloading.
    `connect-src 'self'${storage}${reporting}${streams}${development ? " ws:" : ""}`,
    `media-src 'self'${watching ? " blob: https:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

/** `/e/<slug>/watch`, the only page that plays a stream. */
const WATCH_PAGE = /^\/e\/[^/]+\/watch\/?$/;

/**
 * The object store browsers upload to and download from (the API's
 * S3_PUBLIC_ENDPOINT), as " <origin>" for the policy, or "" if unset.
 */
function storageOrigin(): string {
  const endpoint = process.env.S3_PUBLIC_ENDPOINT;
  const origin = endpoint === undefined ? null : URL.parse(endpoint)?.origin;
  return origin === undefined || origin === null ? "" : ` ${origin}`;
}

export const config = {
  // Pages only: static files and prefetches need no policy of their own.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
