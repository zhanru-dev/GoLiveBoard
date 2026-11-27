"use client";

import { EventPage } from "@goliveboard/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";

import { api } from "@/lib/api";

import { useMe } from "../shell/me-context";
import { demoGuideSteps, type DemoStep } from "./demo-guide-steps";
import { forget, PUBLIC, remember, useRemembered } from "./visits";

/**
 * "Try it in 2 minutes": the demo workspace's guide (docs/design/
 * learnability.md). Five steps through the real features, each ticked by
 * doing it; folded away and back with the summary, remembered.
 */
export function DemoGuide() {
  const { workspaceId } = useMe().activeWorkspace;
  const events = useQuery({
    queryKey: ["demo-guide", workspaceId, "events"],
    queryFn: ({ signal }) =>
      api("/events?limit=100", { schema: EventPage, workspaceId, signal }),
  });
  const closed = useRemembered(workspaceId, "demo-guide-closed", false);
  const steps = demoGuideSteps({
    events: events.data?.items ?? [],
    openedLaunchControl: useRemembered(workspaceId, "launch-control", false),
    tickedTask: useRemembered(workspaceId, "task-done", false),
    registered: useRemembered(PUBLIC, "registered", false),
    triaged: useRemembered(workspaceId, "triage", false),
    openedReport: useRemembered(workspaceId, "report", false),
  });
  const done = steps.filter((step) => step.done).length;

  return (
    <aside
      aria-label="Demo guide"
      className="border-b bg-background px-4 py-4 sm:px-8 xl:col-start-2 xl:row-start-1 xl:border-b-0 xl:border-l xl:px-5 xl:py-6"
    >
      <details
        open={!closed}
        onToggle={(event) => {
          if (event.currentTarget.open) {
            forget(workspaceId, "demo-guide-closed");
          } else {
            remember(workspaceId, "demo-guide-closed");
          }
        }}
        className="group"
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg py-1 [&::-webkit-details-marker]:hidden">
          <span className="flex-1 text-base font-bold">
            Try it in 2 minutes
          </span>
          <span className="figures text-sm text-muted-foreground">
            {done} of {steps.length}
          </span>
          <span
            aria-hidden="true"
            className="text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          >
            ⌄
          </span>
        </summary>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Five things that show what GoLiveBoard does. Each ticks itself when
          you have done it.
        </p>
        <ol className="mt-3">
          {steps.map((step, index) => (
            <GuideStep key={step.id} step={step} number={index + 1} />
          ))}
        </ol>
      </details>
    </aside>
  );
}

function GuideStep({
  step,
  number,
}: Readonly<{ step: DemoStep; number: number }>) {
  const linkClass = "text-sm font-semibold text-primary hover:underline";
  return (
    <li className="flex gap-3 border-t py-3">
      {step.done ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          <span className="sr-only">Done:</span>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="figures flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
        >
          {number}
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={
            step.done
              ? "text-sm font-semibold text-subtle-foreground line-through"
              : "text-sm font-semibold"
          }
        >
          {step.title}
        </span>
        <span className="text-sm leading-relaxed text-muted-foreground">
          {step.what}
        </span>
        {step.external === true ? (
          <a
            href={step.href}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            {step.action}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <Link href={step.href} className={linkClass}>
            {step.action}
          </Link>
        )}
      </span>
    </li>
  );
}
