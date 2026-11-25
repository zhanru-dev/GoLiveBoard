import { type ComponentProps, useId } from "react";
import { cn } from "cn";

import { Label } from "@/components/ui/label";

interface NativeSelectProps extends ComponentProps<"select"> {
  readonly label: string;
  readonly error?: string | undefined;
}

/**
 * A labelled native select, for long lists (time zones) where the
 * browser's own picker with type-to-find is faster than a custom menu.
 */
export function NativeSelect({
  label,
  error,
  className,
  children,
  ...select
}: NativeSelectProps) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        className={cn(
          "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30",
          className,
        )}
        {...select}
      >
        {children}
      </select>
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
