import type { EventStatus } from "@goliveboard/contracts";

export interface DemoStep {
  readonly id: string;
  readonly title: string;
  readonly what: string;
  readonly action: string;
  readonly href: string;
  readonly external?: boolean;
  readonly done: boolean;
}

export interface DemoProgress {
  readonly events: readonly { id: string; slug: string; status: EventStatus }[];
  readonly openedLaunchControl: boolean;
  readonly tickedTask: boolean;
  readonly registered: boolean;
  readonly triaged: boolean;
  readonly openedReport: boolean;
}

/**
 * Five things that show what GoLiveBoard does, in two minutes, using only
 * what the demo workspace allows (docs/design/learnability.md). Each step
 * points at the seeded event it needs: one being prepared, one that ended.
 */
export function demoGuideSteps(progress: DemoProgress): DemoStep[] {
  const preparing = progress.events.find(
    (event) => event.status === "CONFIGURING",
  );
  const ended = progress.events.find((event) => event.status === "COMPLETED");
  const launch =
    preparing === undefined ? "/events" : `/events/${preparing.id}`;
  return [
    {
      id: "launch-control",
      title: "Open an event's Launch Control",
      what: "See its readiness score and what blocks it.",
      action: "Open it",
      href: launch,
      done: progress.openedLaunchControl,
    },
    {
      id: "task",
      title: "Clear a blocker",
      what: "Tick the open critical task in the runbook and watch the score rise.",
      action: "Go to the runbook",
      href: preparing === undefined ? "/events" : `${launch}#runbook`,
      done: progress.tickedTask,
    },
    {
      id: "register",
      title: "Register as an attendee",
      what: "Use the public page with any address; the confirmation arrives in the demo inbox, not by email.",
      action: "Open the public page",
      href: preparing === undefined ? "/events" : `/e/${preparing.slug}`,
      external: preparing !== undefined,
      done: progress.registered,
    },
    {
      id: "triage",
      title: "Let AI sort the questions",
      what: "In Chat and Q&A, suggest groups: duplicates are merged and urgent ones flagged.",
      action: "Go to Chat and Q&A",
      href: preparing === undefined ? "/events" : `${launch}#live-interaction`,
      done: progress.triaged,
    },
    {
      id: "report",
      title: "Read last week's report",
      what: "The audience over time and the incidents of an event that has ended.",
      action: "Open the report",
      href: ended === undefined ? "/events" : `/events/${ended.id}/report`,
      done: progress.openedReport,
    },
  ];
}
