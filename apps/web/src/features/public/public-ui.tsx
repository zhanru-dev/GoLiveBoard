import type { VariantProps } from "class-variance-authority";
import { clsx } from "cn/lite";
import { type ComponentProps, type ReactNode, useId } from "react";

import { buttonVariants } from "@/components/ui/button-variants";

/*
 * The public event page's few controls, styled like the app's (Button,
 * FormField, Alert) but without what those carry: Radix, and the Tailwind
 * class-merging engine, which alone would weigh more than this page's own
 * code. The page has a JavaScript budget of 150 kB compressed (NFR-3), most
 * of which React and Next.js take. Nothing here needs merging: no caller
 * passes classes that conflict with these.
 */

export function PublicButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}

/** A labelled input with its error, announced to screen readers. */
export function PublicField({
  label,
  error,
  className,
  ...input
}: ComponentProps<"input"> & {
  readonly label: string;
  readonly error?: string | undefined;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-2">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-sm leading-none font-medium select-none"
      >
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        className={clsx(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
          className,
        )}
        {...input}
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A boxed message: a status, or an error (`role="alert"`). */
export function PublicNotice({
  role,
  children,
}: Readonly<{ role: "status" | "alert"; children: ReactNode }>) {
  return (
    <div
      role={role}
      className={clsx(
        "grid w-full gap-2 rounded-lg border bg-card px-2.5 py-2 text-left text-sm [&_a]:underline [&_a]:underline-offset-3",
        role === "alert" ? "text-destructive" : "text-card-foreground",
      )}
    >
      {children}
    </div>
  );
}
