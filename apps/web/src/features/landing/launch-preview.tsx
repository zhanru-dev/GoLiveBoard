"use client";

import { Check, Minus } from "lucide-react";
import { cn } from "cn";
import { type ReactNode, useState } from "react";

import { previewReadiness } from "./readiness-preview";

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const STAGES = [
  { name: "Draft", note: "being written" },
  { name: "Configuring", note: "scored, blockers shown" },
  { name: "Ready", note: "no hard blocker" },
  { name: "Live", note: "on air" },
  { name: "Completed", note: "report ready" },
] as const;

/**
 * The home page's hero and lifecycle: a Launch Control card the visitor can
 * use. Ticking the open critical task clears the blocker (72 → 98), which
 * enables "Mark as ready", which moves the lifecycle on to Ready, as the
 * real product does (docs/03).
 */
export function LaunchPreview({ intro }: Readonly<{ intro: ReactNode }>) {
  const [criticalDone, setCriticalDone] = useState(false);
  const [ready, setReady] = useState(false);
  const { criteria, score, blockers } = previewReadiness(criticalDone);
  const current = ready ? 2 : 1;

  return (
    <>
      <section className="mx-auto flex max-w-6xl flex-wrap items-center gap-14 px-6 pt-16 pb-14 sm:px-8 lg:pt-20">
        <div className="flex min-w-0 flex-[1_1_28rem] flex-col gap-6">
          {intro}
        </div>

        <figure
          aria-label="Launch Control preview"
          className="min-w-0 flex-[1_1_28rem] overflow-hidden rounded-2xl border bg-card shadow-[0_24px_48px_-24px_rgb(15_23_42/0.22)]"
        >
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <div className="flex-1">
              <p className="text-xs font-medium text-subtle-foreground">
                Launch Control
              </p>
              <p className="font-semibold">Autumn product launch</p>
            </div>
            <span
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors motion-reduce:transition-none",
                ready
                  ? "bg-success-soft text-success"
                  : "bg-warning-soft text-warning",
              )}
            >
              {ready ? "READY" : "CONFIGURING"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 px-5 py-5">
            <div className="relative size-30 shrink-0">
              <svg viewBox="0 0 120 120" className="size-30" aria-hidden="true">
                <circle
                  cx="60"
                  cy="60"
                  r={RING_RADIUS}
                  fill="none"
                  strokeWidth="10"
                  className="stroke-border"
                />
                <circle
                  cx="60"
                  cy="60"
                  r={RING_RADIUS}
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * (1 - score / 100)}
                  transform="rotate(-90 60 60)"
                  className={cn(
                    "transition-[stroke-dashoffset,stroke] duration-300 motion-reduce:transition-none",
                    blockers === 0 ? "stroke-success" : "stroke-primary",
                  )}
                />
              </svg>
              <p className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="figures text-3xl font-semibold">{score}</span>
                <span className="text-xs text-subtle-foreground">of 100</span>
              </p>
            </div>
            <div className="flex flex-[1_1_12rem] flex-col gap-1">
              <p className="font-semibold" aria-live="polite">
                {blockers === 0
                  ? "No blockers"
                  : `${String(blockers)} hard blocker`}
                <span className="sr-only">
                  {`, readiness ${String(score)} of 100`}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Stream checked <span className="figures">12</span> s ago
              </p>
            </div>
          </div>

          <ul className="grid gap-1 px-5 pb-4 text-sm">
            {criteria.map((criterion) =>
              criterion.name === "Critical tasks" ? (
                <li
                  key={criterion.name}
                  className={cn(
                    "-mx-2.5 rounded-lg px-2.5 transition-colors motion-reduce:transition-none",
                    criterion.blocking && "bg-danger-soft/60",
                  )}
                >
                  <label className="flex cursor-pointer items-center gap-2.5 py-2.5">
                    <input
                      type="checkbox"
                      checked={criticalDone}
                      onChange={(event) => {
                        setCriticalDone(event.target.checked);
                        setReady(false);
                      }}
                      className="size-4.5 cursor-pointer accent-success"
                    />
                    <span className="flex-1 font-semibold">
                      Critical tasks{" "}
                      <span className="font-normal text-muted-foreground">
                        · Confirm captions provider
                      </span>
                    </span>
                    <span
                      className={
                        criterion.blocking
                          ? "font-semibold text-danger"
                          : "text-success"
                      }
                    >
                      {criterion.blocking ? "open · blocking" : "done"}
                    </span>
                    <Points criterion={criterion} />
                  </label>
                </li>
              ) : (
                <li
                  key={criterion.name}
                  className="flex items-center gap-2.5 py-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-4.5 items-center justify-center rounded-full",
                      criterion.score === criterion.maxScore
                        ? "bg-success-soft text-success"
                        : "bg-warning-soft text-warning",
                    )}
                  >
                    {criterion.score === criterion.maxScore ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : (
                      <Minus className="size-3" strokeWidth={3} />
                    )}
                  </span>
                  <span className="flex-1">{criterion.name}</span>
                  <span className="text-subtle-foreground">
                    {criterion.detail}
                  </span>
                  <Points criterion={criterion} />
                </li>
              ),
            )}
          </ul>

          <div className="flex flex-wrap items-center gap-3 border-t bg-muted px-5 py-4">
            <p className="flex-[1_1_12rem] text-sm text-muted-foreground">
              {footNote(ready, blockers)}
            </p>
            <button
              type="button"
              disabled={blockers > 0 || ready}
              onClick={() => {
                setReady(true);
              }}
              className={cn(
                "h-10 rounded-lg px-4 text-sm font-semibold transition-colors motion-reduce:transition-none",
                ready
                  ? "bg-success-soft text-success"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-secondary disabled:text-subtle-foreground",
              )}
            >
              {ready ? "Ready" : "Mark as ready"}
            </button>
          </div>
        </figure>
      </section>

      <section
        id="how"
        aria-labelledby="lifecycle-heading"
        className="border-y bg-muted"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 sm:px-8">
          <h2
            id="lifecycle-heading"
            className="text-xs font-semibold tracking-widest text-subtle-foreground"
          >
            ONE EVENT, START TO FINISH
          </h2>
          <ol className="flex flex-wrap gap-2">
            {STAGES.map((stage, index) => (
              <li
                key={stage.name}
                aria-current={index === current ? "step" : undefined}
                className={cn(
                  "flex flex-[1_1_9rem] items-center gap-2.5 rounded-xl border px-3.5 py-3 transition-colors motion-reduce:transition-none",
                  stageStyle(index, current, ready),
                )}
              >
                <span
                  className={cn(
                    "figures flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                    stageNumberStyle(index, current),
                  )}
                >
                  {index + 1}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{stage.name}</span>
                  <span className="text-xs">{stage.note}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

function Points({
  criterion,
}: Readonly<{ criterion: { score: number; maxScore: number } }>) {
  return (
    <span className="figures w-12 text-right text-muted-foreground">
      {`${String(criterion.score)}/${String(criterion.maxScore)}`}
    </span>
  );
}

function footNote(ready: boolean, blockers: number): string {
  if (ready) {
    return "Marked as ready. Going live is now allowed.";
  }
  return blockers === 0
    ? "Every hard blocker passes."
    : "Tick the critical task to clear the blocker.";
}

function stageStyle(index: number, current: number, ready: boolean): string {
  if (index !== current) {
    return "bg-card";
  }
  return ready
    ? "border-success/30 bg-success-soft text-success"
    : "border-warning/30 bg-warning-soft text-warning";
}

function stageNumberStyle(index: number, current: number): string {
  if (index === current) {
    return "bg-foreground text-background";
  }
  return index < current
    ? "bg-success-soft text-success"
    : "bg-secondary text-muted-foreground";
}
