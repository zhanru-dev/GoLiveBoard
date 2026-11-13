import { type NextRequest, NextResponse } from "next/server";

/**
 * A strict Content Security Policy (docs/02, section 7.1). Scripts run only if
 * they carry this request's random nonce, so a script injected through an XSS
 * bug does not run. Next.js reads the nonce from the request header and adds
 * it to its own scripts; pages are therefore rendered per request.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    // 'strict-dynamic' lets the trusted scripts load the chunks they need.
    // Development needs eval for React's fast refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // React and Radix set inline styles (positions of menus, for example).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Development adds the WebSocket used for hot reloading.
    `connect-src 'self'${development ? " ws:" : ""}`,
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
