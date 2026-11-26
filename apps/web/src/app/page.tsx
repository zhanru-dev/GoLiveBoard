import Link from "next/link";

import { Logo } from "@/components/logo";
import { Features } from "@/features/landing/features";
import { LaunchPreview } from "@/features/landing/launch-preview";
import { TryDemoButton } from "@/features/landing/try-demo-button";

const REPOSITORY = "https://github.com/zhanru-dev/GoLiveBoard";
const DOCS = `${REPOSITORY}/tree/main/docs`;
const ARCHITECTURE = `${REPOSITORY}/tree/main/docs/adr`;

const primary =
  "h-12 bg-primary px-5 text-base text-primary-foreground hover:bg-primary/90";
const secondary =
  "inline-flex h-12 items-center rounded-lg border border-input/40 bg-background px-5 text-base font-semibold hover:bg-muted";

export default function HomePage() {
  // Read at request time, so one image serves every deployment.
  const demoMode = process.env.DEMO_MODE === "true";
  const codeRequired = process.env.SIGN_UP_CODE_REQUIRED === "true";
  // Beside the main call to action: in the demo, signing up (by invitation
  // where codes are set); elsewhere, signing in.
  const [secondHref, secondLabel] = demoMode
    ? [
        "/sign-up",
        codeRequired ? "I have an invite code" : "Create your workspace",
      ]
    : ["/sign-in", "Sign in"];

  return (
    <div className="min-h-dvh bg-background">
      <header className="h-16 border-b">
        <nav
          aria-label="Main"
          className="mx-auto flex h-full max-w-6xl items-center gap-8 px-6 sm:px-8"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold"
          >
            <Logo />
            GoLiveBoard
          </Link>
          <div className="hidden flex-1 gap-6 text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Product
            </a>
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href={DOCS} className="hover:text-foreground">
              Docs
            </a>
            <a href={ARCHITECTURE} className="hover:text-foreground">
              Architecture
            </a>
          </div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link
              href="/sign-in"
              className="px-2 py-2 font-medium whitespace-nowrap"
            >
              Sign in
            </Link>
            {demoMode ? (
              // On a phone the hero's own button is just below.
              <span className="hidden sm:block">
                <TryDemoButton className="h-10 bg-primary px-4 whitespace-nowrap text-primary-foreground hover:bg-primary/90" />
              </span>
            ) : null}
          </div>
        </nav>
      </header>

      <main>
        <LaunchPreview
          intro={
            <>
              <p className="flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-sm font-medium text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-success motion-safe:animate-pulse"
                />
                Live-event readiness and operations
              </p>
              <h1 className="text-5xl leading-[1.05] font-bold tracking-[-0.035em] sm:text-6xl">
                Know your event is ready before you go live.
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                GoLiveBoard scores every launch against what actually breaks
                live events: the stream, the access policy, the runbook. Then it
                runs the room while you’re on air.
              </p>
              <div className="flex flex-wrap gap-3">
                {demoMode ? (
                  <TryDemoButton arrow className={primary} />
                ) : (
                  <Link
                    href="/sign-up"
                    className={`inline-flex items-center rounded-lg font-semibold ${primary}`}
                  >
                    Create your workspace
                  </Link>
                )}
                <Link href={secondHref} className={secondary}>
                  {secondLabel}
                </Link>
              </div>
              {demoMode ? (
                <p className="self-start rounded-lg border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                  No sign-up for the demo. Its data resets every night at{" "}
                  <span className="figures text-foreground">03:00</span> UK
                  time.
                </p>
              ) : null}
            </>
          }
        />

        <Features />

        <section className="mx-auto max-w-6xl px-6 pb-20 sm:px-8">
          <div className="flex flex-wrap items-center gap-6 rounded-3xl bg-ink p-10 text-ink-foreground">
            <div className="flex flex-[1_1_26rem] flex-col gap-2">
              <h2 className="text-3xl font-bold tracking-tight text-white">
                See it run a launch.
              </h2>
              <p className="text-ink-muted">
                {demoMode
                  ? "Open the demo workspace as its Manager. No account, nothing to install."
                  : "Create a workspace and score your first event in minutes."}
              </p>
            </div>
            {demoMode ? (
              <TryDemoButton className="h-12 bg-background px-5 text-base text-foreground hover:bg-secondary" />
            ) : (
              <Link
                href="/sign-up"
                className="inline-flex h-12 items-center rounded-lg bg-background px-5 font-semibold text-foreground hover:bg-secondary"
              >
                Create your workspace
              </Link>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t bg-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-10 px-6 py-11 text-sm sm:px-8">
          <div className="flex flex-[2_1_16rem] flex-col gap-2">
            <p className="text-base font-bold">GoLiveBoard</p>
            <p className="text-muted-foreground">
              Launch control for online events.
            </p>
            <p className="text-subtle-foreground">© 2026 GoLiveBoard</p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              ["#features", "Features"],
              ["#how", "How it works"],
              ["/sign-in", "Sign in"],
            ]}
          />
          <FooterColumn
            title="Resources"
            links={[
              [DOCS, "Docs"],
              [`${REPOSITORY}/blob/main/docs/04-api-and-contracts.md`, "API"],
              [ARCHITECTURE, "Architecture"],
            ]}
          />
          <FooterColumn
            title="Code"
            links={[
              [REPOSITORY, "GitHub"],
              [`${REPOSITORY}/tree/main/docs/runbooks`, "Runbooks"],
            ]}
          />
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  links,
}: Readonly<{ title: string; links: readonly (readonly [string, string])[] }>) {
  return (
    <nav aria-label={title} className="flex flex-[1_1_8rem] flex-col gap-2">
      <p className="font-semibold">{title}</p>
      {links.map(([href, label]) => (
        <a
          key={href}
          href={href}
          className="text-muted-foreground hover:text-foreground"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
