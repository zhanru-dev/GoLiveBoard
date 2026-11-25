import { type ComponentProps, useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormFieldProps extends ComponentProps<typeof Input> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string;
}

/**
 * A labelled input with its hint and error announced to screen readers
 * (aria-describedby), and marked invalid when there is an error.
 */
export function FormField({ label, error, hint, ...input }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? null : hintId,
    error === undefined ? null : errorId,
  ]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...input}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
