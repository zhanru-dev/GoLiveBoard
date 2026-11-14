import { cn } from "cn";
import type { ComponentProps } from "react";

/**
 * A plain `<label>`. (shadcn/ui's wraps Radix's, which only stops a double
 * click from selecting the text; not worth its weight on the public page,
 * NFR-3.)
 */
function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
