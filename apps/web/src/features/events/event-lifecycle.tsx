import type { EventStatus } from "@goliveboard/contracts";
import { cn } from "cn";
import { Check } from "lucide-react";

import { STATUS_LABELS } from "./event-status";
import { nextStep, STAGES } from "./lifecycle";

/**
 * Where an event is in its life and what to do next, in words
 * (docs/design/learnability.md).
 */
export function EventLifecycle({
  status,
  blockers,
}: Readonly<{ status: EventStatus; blockers?: number }>) {
  const current = STAGES.indexOf(status as (typeof STAGES)[number]);
  const urgent =
    status === "CONFIGURING" && blockers !== undefined && blockers > 0;
  return (
    <section
      aria-label="Where this event is"
      className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5"
    >
      {current === -1 ? null : (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          {STAGES.map((stage, index) => (
            <li
              key={stage}
              aria-current={index === current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5",
                index < current && "font-medium text-success",
                index === current && "font-bold",
                index > current && "text-subtle-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "figures flex size-5 items-center justify-center rounded-full text-xs",
                  index < current && "bg-success-soft",
                  index === current && "bg-foreground text-background",
                  index > current && "bg-secondary",
                )}
              >
                {index < current ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>
              {STATUS_LABELS[stage]}
              {index < STAGES.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="ml-1 h-0.5 w-5 rounded bg-border"
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p
        className={cn(
          "rounded-lg px-3.5 py-2.5 text-sm",
          urgent ? "bg-danger-soft text-danger" : "bg-muted",
        )}
      >
        <strong>Next step:</strong> {nextStep(status, blockers)}
      </p>
    </section>
  );
}
