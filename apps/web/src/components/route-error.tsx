"use client";

import { useEffect, useRef } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { reportCaughtError } from "@/lib/report-caught-error";

/**
 * What a route shows when its page fails to render (Next.js `error.tsx`):
 * the layout around it (the app's header and navigation) stays, so the
 * visitor can go elsewhere. The error is reported, focus moves to the
 * message so screen readers announce it, and "Try again" fetches and
 * renders the page afresh (Next.js `retry`).
 */
export function RouteError({
  error,
  retry,
}: Readonly<{ error: unknown; retry: () => void }>) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    reportCaughtError(error);
    heading.current?.focus();
  }, [error]);

  return (
    <div role="alert" className="grid justify-items-start gap-3 py-8">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight outline-none"
      >
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        This page could not be shown. It has been reported. Try again, or go
        back to where you were.
      </p>
      <button
        type="button"
        className={buttonVariants({ variant: "default" })}
        onClick={() => {
          retry();
        }}
      >
        Try again
      </button>
    </div>
  );
}
