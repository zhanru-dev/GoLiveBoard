"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { refreshSession } from "@/lib/api";

/**
 * Shown when the server found no valid access token (it lasts 15 minutes).
 * The refresh cookie is only sent to the API's auth endpoints, so the browser
 * renews the session itself, then reloads the page; if that fails, the user
 * signs in again and comes back here afterwards.
 */
export function RestoreSession() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    void refreshSession().then((restored) => {
      if (restored) {
        router.refresh();
      } else {
        router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      }
    });
  }, [pathname, router]);

  return (
    <p role="status" className="p-6 text-muted-foreground">
      Restoring your session…
    </p>
  );
}
