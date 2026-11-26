import type { EventStatus } from "@goliveboard/contracts";
import { cn } from "cn";
import Link from "next/link";
import type { ReactNode } from "react";

export type EventPage = "launch-control" | "ops-room" | "report";

/**
 * An event's pages, each with what it is for (docs/design/learnability.md):
 * the same tabs on Launch Control, the ops room and the report. The report
 * exists once the event has ended; until then the tab says so.
 */
export function EventTabs({
  event,
  current,
}: Readonly<{
  event: { id: string; slug: string; status: EventStatus };
  current: EventPage;
}>) {
  const ended = event.status === "COMPLETED" || event.status === "ARCHIVED";
  return (
    <nav
      aria-label="Event pages"
      className="flex flex-wrap gap-x-1 gap-y-2 border-b"
    >
      <Tab
        href={`/events/${event.id}`}
        current={current === "launch-control"}
        label="Launch Control"
        hint="Prepare and check"
      />
      <Tab
        href={`/events/${event.id}/live`}
        current={current === "ops-room"}
        label="Operations room"
        hint="Run it live"
      />
      {ended || current === "report" ? (
        <Tab
          href={`/events/${event.id}/report`}
          current={current === "report"}
          label="Report"
          hint="After it ends"
        />
      ) : (
        <Item label="Report" hint="Once the event has ended" muted />
      )}
      <Tab
        href={`/e/${event.slug}`}
        current={false}
        label="Public page"
        hint="What attendees see"
        external
      />
      <Tab
        href={`/audit?eventId=${event.id}`}
        current={false}
        label="Audit trail"
        hint="Every change"
      />
    </nav>
  );
}

function Tab({
  href,
  current,
  label,
  hint,
  external = false,
}: Readonly<{
  href: string;
  current: boolean;
  label: string;
  hint: string;
  external?: boolean;
}>) {
  const hintId = `tab-hint-${label.toLowerCase().replaceAll(" ", "-")}`;
  const className = cn(
    "-mb-px flex flex-col gap-0.5 border-b-2 px-3.5 py-2.5",
    current
      ? "border-primary text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );
  // The name is the visible title alone ("Operations room"), so voice
  // users can say what they see (WCAG 2.5.3); the hint below it is the
  // description, kept out of the name.
  const content: ReactNode = (
    <>
      <span className="text-sm font-semibold">
        {label}
        {external ? (
          <>
            {" "}
            <span className="sr-only">(opens in a new tab)</span>
          </>
        ) : null}
      </span>
      <span
        id={hintId}
        aria-hidden="true"
        className="text-xs text-subtle-foreground"
      >
        {hint}
      </span>
    </>
  );
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-describedby={hintId}
      className={className}
    >
      {content}
    </a>
  ) : (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      aria-describedby={hintId}
      className={className}
    >
      {content}
    </Link>
  );
}

function Item({
  label,
  hint,
  muted,
}: Readonly<{ label: string; hint: string; muted: boolean }>) {
  return (
    <span
      className={cn(
        "flex flex-col gap-0.5 px-3.5 py-2.5",
        muted && "text-subtle-foreground",
      )}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs">{hint}</span>
    </span>
  );
}
