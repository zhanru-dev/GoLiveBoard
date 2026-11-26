import type { ReactNode } from "react";

/**
 * The home page's six features, each with a small preview that is true to
 * the product (docs/design/ui-direction.md): points from docs/03, the
 * 30-second stream check, the access modes, the HMAC-SHA256 signature.
 */
export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="mx-auto max-w-6xl px-6 py-20 sm:px-8"
    >
      <h2
        id="features-heading"
        className="text-3xl font-bold tracking-tight sm:text-4xl"
      >
        Everything a live event needs, in one board
      </h2>
      <p className="mt-3 mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Built for the producer who gets the call when the stream drops.
      </p>
      <div className="flex flex-wrap gap-5">
        <Feature
          wide
          number="01"
          label="Readiness"
          title="A score with reasons"
          text="Six criteria out of 100. Four are hard blockers: Ready and Live are refused until they pass."
        >
          <div
            role="img"
            aria-label="Points: access policy 20, stream 25, critical tasks 25, holding slate 10, all tasks 10, owner and description 10"
            className="flex h-8 overflow-hidden rounded-lg text-xs font-semibold text-primary-foreground"
          >
            <span className="flex flex-[20] items-center bg-primary pl-2">
              Access 20
            </span>
            <span className="flex flex-[25] items-center border-l-2 border-background bg-primary pl-2">
              Stream 25
            </span>
            <span className="flex flex-[25] items-center border-l-2 border-background bg-primary pl-2">
              Critical 25
            </span>
            <span className="flex flex-[10] items-center border-l-2 border-background bg-primary pl-1.5">
              Slate
            </span>
            <span className="flex-[10] border-l-2 border-background bg-border" />
            <span className="flex-[10] border-l-2 border-background bg-border" />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-danger-soft px-2 py-1 font-semibold text-danger">
              <span className="figures">409</span> · blocked: critical task open
            </span>
            <span className="rounded-md bg-secondary px-2 py-1 text-muted-foreground">
              blue: hard blocker · grey: points only
            </span>
          </div>
        </Feature>

        <Feature
          number="02"
          label="Stream checks"
          title="Outages caught in seconds"
          text="Checked every 30 seconds. A failure opens an incident in the ops room."
        >
          <div
            role="img"
            aria-label="Twelve checks: two failures in a row, then reachable again"
            className="flex h-7 gap-0.5"
          >
            {[1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1].map((ok, index) => (
              <span
                // A fixed picture, in order: the position is the identity.
                key={`check-${String(index)}`}
                className={`flex-1 rounded-sm ${ok === 1 ? "bg-success-soft" : "bg-danger"}`}
              />
            ))}
          </div>
          <p className="grid gap-1 text-xs text-muted-foreground">
            <span>
              <span className="figures">19:30:12</span> ·{" "}
              <strong className="text-danger">STREAM_UNREACHABLE</strong> opened
            </span>
            <span>
              <span className="figures">19:31:16</span> · resolved after{" "}
              <span className="figures">64</span> s
            </span>
          </p>
        </Feature>

        <Feature
          number="03"
          label="Ops room"
          title="The room, live"
          text="Viewers, chat, questions and incidents, updated in real time."
        >
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-ink p-3 text-ink-foreground">
            <Figure label="Watching" value="1,284" />
            <Figure label="Questions" value="46" />
            <Figure label="Incidents" value="0" />
          </dl>
        </Feature>

        <Feature
          number="04"
          label="Audience"
          title="Who gets in"
          text="Anyone, one email domain, or invited people only. Every attendee verifies their address."
        >
          <p className="flex rounded-lg bg-secondary p-0.5 text-xs font-semibold">
            <span className="flex-1 px-1 py-1.5 text-center text-muted-foreground">
              Public
            </span>
            <span className="flex-[1.4] px-1 py-1.5 text-center text-muted-foreground">
              @northwind.example
            </span>
            <span className="flex-[1.2] rounded-md bg-card px-1 py-1.5 text-center shadow-sm">
              Invite only
            </span>
          </p>
          <p className="text-xs text-success">
            ✓ grace@northwind.example verified
          </p>
        </Feature>

        <Feature
          number="05"
          label="AI triage"
          title="Questions, sorted"
          text="Claude groups duplicate questions and flags the urgent ones for the host."
        >
          <ul className="grid gap-1.5 text-xs">
            <li className="rounded-lg bg-danger-soft px-2.5 py-2 text-danger">
              <strong>Urgent</strong> · “Audio is out of sync with the slides”
            </li>
            <li className="rounded-lg border bg-muted px-2.5 py-2">
              “Is there a replay?”{" "}
              <strong className="figures text-primary">+3 merged</strong>
            </li>
          </ul>
        </Feature>

        <Feature
          wide
          number="06"
          label="After the show"
          title="Reports, an audit trail and signed webhooks"
          text="Audience over time and incidents per event, every change by whom, and webhooks your systems can verify."
        >
          <div className="overflow-x-auto rounded-xl border text-xs">
            <p className="flex gap-3 border-b px-3 py-2">
              <span className="figures text-subtle-foreground">18:00:04</span>
              <span>
                Ada Lovelace moved the event to <strong>LIVE</strong> · score{" "}
                <span className="figures">98</span>
              </span>
            </p>
            <p className="flex gap-3 border-b px-3 py-2">
              <span className="figures text-subtle-foreground">17:52:31</span>
              <span>Grace Hopper completed “Confirm captions provider”</span>
            </p>
            <p className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="figures text-subtle-foreground">18:00:05</span>
              <span className="figures flex-1">POST event.live → 200</span>
              <span className="rounded-md bg-success-soft px-2 py-0.5 font-semibold text-success">
                v1 = HMAC-SHA256
              </span>
            </p>
          </div>
        </Feature>
      </div>
    </section>
  );
}

function Feature({
  number,
  label,
  title,
  text,
  wide = false,
  children,
}: Readonly<{
  number: string;
  label: string;
  title: string;
  text: string;
  wide?: boolean;
  children: ReactNode;
}>) {
  return (
    <article
      className={`flex min-w-0 flex-col gap-2.5 rounded-2xl border p-7 ${wide ? "flex-[2_1_34rem]" : "flex-[1_1_19rem]"}`}
    >
      <p className="figures text-sm font-semibold text-primary">
        {number} · {label.toUpperCase()}
      </p>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="leading-relaxed text-muted-foreground">{text}</p>
      <div className="mt-2 grid gap-2.5">{children}</div>
    </article>
  );
}

function Figure({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="figures text-lg font-semibold">{value}</dd>
    </div>
  );
}
