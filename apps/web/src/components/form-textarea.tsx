import { type ComponentProps, useId } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface FormTextareaProps extends ComponentProps<typeof Textarea> {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string;
}

/** A labelled text area; hint and error are announced like FormField's. */
export function FormTextarea({
  label,
  error,
  hint,
  ...textarea
}: FormTextareaProps) {
  const id = useId();
  const describedBy = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...textarea}
      />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
