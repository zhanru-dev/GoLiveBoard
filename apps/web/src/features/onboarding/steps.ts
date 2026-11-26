import type { EventStatus, Role } from "@goliveboard/contracts";

/** What the workspace has done so far, from the API and this browser. */
export interface Progress {
  readonly role: Role;
  /** Its events, newest activity first (the first is the one to suggest). */
  readonly events: readonly { id: string; slug: string; status: EventStatus }[];
  readonly members: number;
  /** Owners only; undefined for the others, who cannot see webhooks. */
  readonly webhooks?: number;
  readonly openedOpsRoom: boolean;
  readonly openedPublicPage: boolean;
}

export interface Step {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly action: string;
  readonly href: string;
  readonly done: boolean;
  /** Opens in a new tab: the public page. */
  readonly external?: boolean;
}

const BEEN_READY: ReadonlySet<EventStatus> = new Set([
  "READY",
  "LIVE",
  "COMPLETED",
]);

/**
 * The getting-started checklist (docs/design/learnability.md): every step
 * ticks itself from what has really been done. Owners see the steps only
 * they can take; Analysts, who change nothing, see none.
 */
export function gettingStartedSteps(progress: Progress): Step[] {
  if (progress.role === "ANALYST") {
    return [];
  }
  const owner = progress.role === "OWNER";
  const first = progress.events[0];
  const eventPage = first === undefined ? "/events/new" : `/events/${first.id}`;
  const steps: (Step | undefined)[] = [
    {
      id: "event",
      title: "Create an event",
      why: "Give it a title and times; Launch Control then shows what it needs.",
      action: "Create your first event",
      href: "/events/new",
      done: progress.events.length > 0,
    },
    {
      id: "ready",
      title: "Make an event ready to go live",
      why: "Launch Control scores it and lists what blocks it: clear the blockers, then mark it ready.",
      action: "Open Launch Control",
      href: eventPage,
      done: progress.events.some((event) => BEEN_READY.has(event.status)),
    },
    owner
      ? {
          id: "team",
          title: "Invite a teammate",
          why: "Managers run events with you; Analysts can only look.",
          action: "Invite",
          href: "/settings/team",
          done: progress.members > 1,
        }
      : undefined,
    {
      id: "ops-room",
      title: "Open an operations room",
      why: "Where you follow viewers, chat, questions and incidents while live.",
      action: "Open it",
      href: first === undefined ? "/events/new" : `/events/${first.id}/live`,
      done: progress.openedOpsRoom,
    },
    {
      id: "public-page",
      title: "See what attendees see",
      why: "The public page: registration, then the watch page with chat and Q&A.",
      action: "Open the public page",
      href: first === undefined ? "/events/new" : `/e/${first.slug}`,
      external: first !== undefined,
      done: progress.openedPublicPage,
    },
    owner
      ? {
          id: "webhook",
          title: "Send events to your own systems",
          why: "A signed webhook for every status change.",
          action: "Add a webhook",
          href: "/settings/integrations",
          done: (progress.webhooks ?? 0) > 0,
        }
      : undefined,
  ];
  return steps.filter((step) => step !== undefined);
}
