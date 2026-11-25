"use client";

import { useEffect, useRef } from "react";

import { reportCaughtError } from "@/lib/report-caught-error";

/**
 * What a route shows when its page fails to render (Next.js `error.tsx`):
 * the layout around it (the app's header and navigation) stays, so the
 * visitor can go elsewhere. The error is reported, focus moves to the
 * message so screen readers announce it, and "Try again" fetches and
 * renders the page afresh (Next.js `retry`).
 */
/*
 * The default button's look, written out: every route group's error page
 * and the global one are loaded with each page, each with its own copy of
 * what they import, and buttonVariants would bring the class-variance
 * engine and every variant into each (about 1.3 kB a copy, against the
 * public page's 150 kB budget).
 */
const BUTTON =
  "inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50";

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
        className={BUTTON}
        onClick={() => {
          retry();
        }}
      >
        Try again
      </button>
    </div>
  );
}
