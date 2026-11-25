"use client";

import { useSyncExternalStore } from "react";

/**
 * The token from an emailed link (`/reset-password#token=…`). It travels in
 * the URL fragment, which browsers never send to a server, so it cannot end
 * up in any log. Returns "" on the server and when the link has no token.
 */
export function useLinkToken(): string {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
    () => "",
  );
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}
