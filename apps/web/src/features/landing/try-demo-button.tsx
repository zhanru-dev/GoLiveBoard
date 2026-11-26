"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "cn";

import { useDemoSignIn } from "@/features/auth/demo-sign-in";

/**
 * "Try the demo" on the home page: signs straight in to the shared demo
 * workspace (FR-AUTH-5), so a visitor is one click from the product.
 */
export function TryDemoButton({
  className,
  arrow = false,
}: Readonly<{ className?: string; arrow?: boolean }>) {
  const { signIn, pending, error } = useDemoSignIn();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void signIn()}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-70",
          className,
        )}
      >
        {pending ? "Opening the demo…" : "Try the demo"}
        {arrow ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
      </button>
      {error === "" ? null : (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
