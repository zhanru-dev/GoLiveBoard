"use client";

import { EventPage, Member, WebhookEndpoint } from "@goliveboard/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { api } from "@/lib/api";

import { useMe } from "../shell/me-context";
import { gettingStartedSteps, type Step } from "./steps";
import { remember, useRemembered } from "./visits";

/**
 * The getting-started checklist on the Events page (docs/design/
 * learnability.md): for a real workspace's Owners and Managers, until
 * every step is done or they hide it.
 */
export function GettingStarted() {
  const { workspaceId, role, isDemo } = useMe().activeWorkspace;
  const owner = role === "OWNER";
  const shown = !isDemo && role !== "ANALYST";
  // From this browser's storage; the server, which cannot know, renders
  // the list hidden.
  const visits = {
    opsRoom: useRemembered(workspaceId, "ops-room", false),
    publicPage: useRemembered(workspaceId, "public-page", false),
    dismissed: useRemembered(workspaceId, "dismissed", true),
  };

  const events = useQuery({
    queryKey: ["getting-started", workspaceId, "events"],
    queryFn: ({ signal }) =>
      api("/events?limit=100", { schema: EventPage, workspaceId, signal }),
    enabled: shown,
  });
  const members = useQuery({
    queryKey: ["getting-started", workspaceId, "members"],
    queryFn: ({ signal }) =>
      api("/workspace/members", {
        schema: z.array(Member),
        workspaceId,
        signal,
      }),
    enabled: shown,
  });
  const webhooks = useQuery({
    queryKey: ["getting-started", workspaceId, "webhooks"],
    queryFn: ({ signal }) =>
      api("/webhook-endpoints", {
        schema: z.array(WebhookEndpoint),
        workspaceId,
        signal,
      }),
    enabled: shown && owner,
  });

  if (
    !shown ||
    visits.dismissed ||
    !events.isSuccess ||
    !members.isSuccess ||
    (owner && !webhooks.isSuccess)
  ) {
    return null;
  }
  const steps = gettingStartedSteps({
    role,
    events: events.data.items,
    members: members.data.length,
    webhooks: webhooks.data?.length,
    openedOpsRoom: visits.opsRoom,
    openedPublicPage: visits.publicPage,
  });
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) {
    return null;
  }

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="flex flex-wrap gap-8 rounded-2xl border bg-card p-5 sm:p-6"
    >
      <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-2.5">
        <h2 id="getting-started-heading" className="text-lg font-bold">
          Get started with GoLiveBoard
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          These steps take you through everything, from a first event to a live
          room. Each ticks itself when you have done it.
        </p>
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden="true"
            className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${String((100 * done) / steps.length)}%` }}
            />
          </div>
          <p className="figures text-sm text-muted-foreground">
            {done} of {steps.length} done
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-4 text-sm">
          <Link
            href="/help"
            className="font-semibold text-primary hover:underline"
          >
            See every feature
          </Link>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              remember(workspaceId, "dismissed");
            }}
          >
            Hide this list
          </button>
        </div>
      </div>
      <ol className="min-w-0 flex-[2_1_28rem]">
        {steps.map((step) => (
          <StepItem
            key={step.id}
            step={step}
            onOpen={() => {
              if (step.id === "public-page") {
                remember(workspaceId, "public-page");
              }
            }}
          />
        ))}
      </ol>
    </section>
  );
}

function StepItem({
  step,
  onOpen,
}: Readonly<{ step: Step; onOpen: () => void }>) {
  return (
    <li className="flex items-start gap-3 border-t py-3 first:border-t-0 first:pt-0">
      {step.done ? (
        <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          <span className="sr-only">Done:</span>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="size-5.5 shrink-0 rounded-full border-2 border-input/40"
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={
            step.done
              ? "text-sm font-semibold text-subtle-foreground line-through"
              : "text-sm font-semibold"
          }
        >
          {step.title}
        </span>
        {step.done ? null : (
          <span className="text-sm text-muted-foreground">{step.why}</span>
        )}
      </span>
      {step.done ? null : <StepLink step={step} onOpen={onOpen} />}
    </li>
  );
}

function StepLink({
  step,
  onOpen,
}: Readonly<{ step: Step; onOpen: () => void }>) {
  const className =
    "text-sm font-semibold whitespace-nowrap text-primary hover:underline";
  return step.external === true ? (
    <a
      href={step.href}
      target="_blank"
      rel="noreferrer"
      onClick={onOpen}
      className={className}
    >
      {step.action}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={step.href} onClick={onOpen} className={className}>
      {step.action}
    </Link>
  );
}
