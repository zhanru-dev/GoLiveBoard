import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { Providers } from "@/lib/providers";

/**
 * Sign-in, sign-up, password reset and invitations: the form on the right;
 * on wide screens, the product on a dark panel to its left.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <Providers>
      <div className="grid min-h-dvh lg:grid-cols-2">
        <aside className="hidden flex-col gap-8 bg-ink p-12 text-ink-foreground lg:flex">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold text-white"
          >
            <Logo className="bg-ink-panel" />
            GoLiveBoard
          </Link>
          <div className="mt-auto flex max-w-md flex-col gap-4">
            <p className="text-4xl leading-tight font-bold tracking-tight text-white">
              Every launch scored, every incident caught.
            </p>
            <p className="leading-relaxed text-ink-muted">
              Launch Control tells you when an event is ready to go live; the
              ops room keeps it under control while it runs.
            </p>
          </div>
          <dl className="grid max-w-md gap-2.5 rounded-xl border border-ink-border bg-ink-panel p-4 text-sm">
            <Criterion name="Stream reachable" points="25/25" passed />
            <Criterion name="Access policy" points="20/20" passed />
            <Criterion name="Critical tasks" points="0/25" passed={false} />
          </dl>
        </aside>
        <main className="flex flex-col justify-center px-6 py-10">
          <div className="mx-auto grid w-full max-w-sm gap-6">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-xl font-semibold lg:hidden"
            >
              <Logo />
              GoLiveBoard
            </Link>
            {children}
          </div>
        </main>
      </div>
    </Providers>
  );
}

function Criterion({
  name,
  points,
  passed,
}: Readonly<{ name: string; points: string; passed: boolean }>) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${passed ? "bg-success-soft" : "bg-live"}`}
      />
      <dt className="flex-1">{name}</dt>
      <dd className="figures text-ink-muted">{points}</dd>
    </div>
  );
}
