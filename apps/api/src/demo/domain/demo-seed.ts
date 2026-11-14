/** The demo workspace's three people (demo-accounts.ts). */
export type DemoPersonKey = "owner" | "manager" | "analyst";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface DemoTask {
  readonly title: string;
  readonly isCritical: boolean;
  readonly owner: DemoPersonKey | null;
  readonly dueAt: Date | null;
  /** Who completed it, or null while it is open. */
  readonly completedBy: DemoPersonKey | null;
  readonly completedAt: Date | null;
}

export interface DemoEvent {
  readonly title: string;
  readonly description: string;
  readonly status: "DRAFT" | "CONFIGURING" | "COMPLETED" | "ARCHIVED";
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly owner: DemoPersonKey | null;
  readonly expectedAttendance: number | null;
  readonly tasks: readonly DemoTask[];
  readonly accessPolicy: {
    readonly mode: "PUBLIC" | "EMAIL_DOMAIN" | "INVITE_ONLY";
    readonly allowedDomains: readonly string[];
    readonly privacyNoticeVersion: string;
  } | null;
}

function task(
  title: string,
  options: Partial<Omit<DemoTask, "title">> = {},
): DemoTask {
  return {
    title,
    isCritical: options.isCritical ?? false,
    owner: options.owner ?? null,
    dueAt: options.dueAt ?? null,
    completedBy: options.completedBy ?? null,
    completedAt: options.completedAt ?? null,
  };
}

/**
 * The demo workspace's events, placed around `now` so the demo always looks
 * current: one being prepared (with blockers left to clear), one still a
 * draft, one that ran last week and one archived.
 *
 * No event is READY or LIVE: those states promise a recent successful stream
 * check, and a seed cannot keep that promise (docs/03, section 5). A visitor
 * gets there by preparing an event themselves.
 */
export function demoSeed(now: Date): readonly DemoEvent[] {
  // On the hour, so times read naturally.
  const hour = new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
  const at = (days: number, hours = 0) =>
    new Date(hour.getTime() + days * DAY_MS + hours * HOUR_MS);

  const launchStart = at(3);
  const conferenceStart = at(-7);
  return [
    {
      title: "Autumn product launch",
      description:
        "Our biggest release of the year, streamed to customers and partners.",
      status: "CONFIGURING",
      startsAt: launchStart,
      endsAt: at(3, 1.5),
      timeZone: "Europe/London",
      owner: "manager",
      expectedAttendance: 400,
      tasks: [
        task("Rehearse the opening", {
          isCritical: true,
          owner: "owner",
          dueAt: at(2),
          completedBy: "owner",
          completedAt: at(0, -2),
        }),
        task("Check the speakers' microphones", {
          isCritical: true,
          owner: "manager",
          dueAt: at(3, -2),
        }),
        task("Brief the Q&A moderators", {
          owner: "analyst",
          dueAt: at(3, -1),
        }),
        task("Send the reminder email", { dueAt: at(2) }),
      ],
      accessPolicy: {
        mode: "EMAIL_DOMAIN",
        allowedDomains: ["northwind.example"],
        privacyNoticeVersion: "2026-11",
      },
    },
    {
      title: "Quarterly all-hands",
      description: "Results, plans and questions from the whole company.",
      status: "DRAFT",
      startsAt: at(14),
      endsAt: at(14, 1),
      timeZone: "Europe/London",
      owner: "owner",
      expectedAttendance: 120,
      tasks: [],
      accessPolicy: null,
    },
    {
      title: "Customer conference",
      description: "A day of talks and workshops for our customers.",
      status: "COMPLETED",
      startsAt: conferenceStart,
      endsAt: at(-7, 6),
      timeZone: "America/New_York",
      owner: "manager",
      expectedAttendance: 900,
      tasks: [
        task("Confirm the keynote speaker", {
          isCritical: true,
          owner: "owner",
          completedBy: "owner",
          completedAt: at(-10),
        }),
        task("Test the stream from the venue", {
          isCritical: true,
          owner: "manager",
          completedBy: "manager",
          completedAt: at(-8),
        }),
      ],
      accessPolicy: {
        mode: "PUBLIC",
        allowedDomains: [],
        privacyNoticeVersion: "2026-10",
      },
    },
    {
      title: "Spring partner webinar",
      description: "An hour with our partners on the new integrations.",
      status: "ARCHIVED",
      startsAt: at(-60),
      endsAt: at(-60, 1),
      timeZone: "Europe/Berlin",
      owner: null,
      expectedAttendance: null,
      tasks: [],
      accessPolicy: null,
    },
  ];
}
