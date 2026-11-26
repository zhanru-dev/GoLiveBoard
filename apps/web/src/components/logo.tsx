import { cn } from "cn";

/** The mark: a broadcast light in a dark square. */
export function Logo({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink",
        className,
      )}
    >
      <span className="size-2.5 rounded-full bg-live" />
    </span>
  );
}
