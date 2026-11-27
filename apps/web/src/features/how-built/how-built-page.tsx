import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

import {
  ARCHITECTURE_DOC,
  DECISIONS,
  EVIDENCE,
  FIGURES,
  LIMITS,
  onGitHub,
  type PathStep,
  RELEASE_PATH,
  RELEASE_STEPS,
  REPOSITORY,
  REQUEST_PATH,
  ROLLBACK_DRILL,
  ROLLBACK_RUNBOOK,
} from "./content";

const link = "font-medium text-primary underline-offset-4 hover:underline";

/** The engineering behind the product, for the people who evaluate it. */
export function HowBuiltPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="h-16 border-b">
        <nav
          aria-label="Main"
          className="mx-auto flex h-full max-w-5xl items-center gap-6 px-6 sm:px-8"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold"
          >
            <Logo />
            GoLiveBoard
          </Link>
          <a
            href={REPOSITORY}
            className="ml-auto px-2 py-2 font-medium text-muted-foreground hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-14 sm:px-8">
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
            How GoLiveBoard is built
          </h1>
          <p className="text-lg leading-relaxed text-muted-foreground">
            A modular monolith on one AWS host, deployed on every merge, that
            rolls itself back when a smoke test fails. This page is the short
            version; each claim links to the evidence in the repository, and the
            API describes itself at{" "}
            <a href="/api/v1/openapi.json" className={link}>
              /api/v1/openapi.json
            </a>
            .
          </p>
        </div>

        <ul aria-label="In figures" className="flex flex-wrap gap-4">
          {FIGURES.map((figure) => (
            <li
              key={figure.value}
              className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 rounded-xl border p-5"
            >
              <span className="figures text-3xl font-bold tracking-tight">
                {figure.value}
              </span>
              <span className="text-sm text-muted-foreground">
                {figure.label}{" "}
                <a href={onGitHub(figure.source)} className={link}>
                  Source
                </a>
              </span>
            </li>
          ))}
        </ul>

        <Section
          id="architecture"
          title="Two paths to one host"
          lead="Visitors reach the host through Caddy; releases reach it through GitHub's OIDC token and AWS Systems Manager. There is no SSH port and no stored AWS key."
        >
          <Path label="A request" steps={REQUEST_PATH} />
          <Path label="A release" steps={RELEASE_PATH} />
          <p className="text-sm text-muted-foreground">
            Video never passes through GoLiveBoard: attendees watch the
            customer&apos;s own stream, which the worker checks every 30
            seconds.{" "}
            <a href={onGitHub(ARCHITECTURE_DOC)} className={link}>
              Architecture
            </a>
          </p>
        </Section>

        <Section
          id="decisions"
          title="Decisions, and what they cost"
          lead="Each is recorded as an architecture decision, with the alternatives it beat."
        >
          <ul className="grid gap-4 sm:grid-cols-2">
            {DECISIONS.map((decision) => (
              <li
                key={decision.title}
                className="flex flex-col gap-2 rounded-xl border p-5"
              >
                <h3 className="font-bold">{decision.title}</h3>
                <p className="text-sm leading-relaxed">{decision.why}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Cost:</span>{" "}
                  {decision.cost}
                </p>
                <a
                  href={onGitHub(decision.record)}
                  className={`text-sm ${link}`}
                >
                  The decision record
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="release"
          title="How a commit reaches production"
          lead="Nobody deploys by hand: merging is the deploy."
        >
          <ol className="flex list-decimal flex-col gap-3 pl-6 leading-relaxed marker:font-semibold">
            {RELEASE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="rounded-xl border bg-muted p-5 leading-relaxed">
            {ROLLBACK_DRILL}{" "}
            <a href={onGitHub(ROLLBACK_RUNBOOK)} className={link}>
              The runbook
            </a>
          </p>
        </Section>

        <Section
          id="evidence"
          title="The evidence"
          lead="The documents behind the claims above."
        >
          <ul className="grid gap-4 sm:grid-cols-2">
            {EVIDENCE.map((item) => (
              <li key={item.path} className="flex flex-col gap-1">
                <a href={onGitHub(item.path)} className={link}>
                  {item.title}
                </a>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {item.detail}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="limits"
          title="Limits, stated plainly"
          lead="Where this stops short of production, on purpose or not yet."
        >
          <ul className="flex list-disc flex-col gap-3 pl-6 leading-relaxed">
            {LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </Section>
      </main>

      <footer className="border-t bg-muted">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-6 px-6 py-8 text-sm sm:px-8">
          <Link href="/" className="font-medium hover:underline">
            Home
          </Link>
          <a href={REPOSITORY} className="font-medium hover:underline">
            Source on GitHub
          </a>
          <a
            href={`${REPOSITORY}/tree/main/docs`}
            className="font-medium hover:underline"
          >
            Docs
          </a>
        </div>
      </footer>
    </div>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: Readonly<{ id: string; title: string; lead: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-5">
      <div className="flex max-w-3xl flex-col gap-2">
        <h2 id={`${id}-heading`} className="text-2xl font-bold tracking-tight">
          {title}
        </h2>
        <p className="leading-relaxed text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  );
}

/** A path drawn as a row of steps; a list, so screen readers get the order. */
function Path({
  label,
  steps,
}: Readonly<{ label: string; steps: readonly PathStep[] }>) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
      <ol aria-label={label} className="flex flex-wrap items-stretch gap-2">
        {steps.map((step, index) => (
          <li
            key={step.name}
            className="flex min-w-0 flex-[1_1_10rem] items-center gap-2"
          >
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
            ) : null}
            <span className="flex flex-1 flex-col rounded-lg border px-3.5 py-2.5">
              <span className="font-semibold">{step.name}</span>
              <span className="text-sm text-muted-foreground">
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
