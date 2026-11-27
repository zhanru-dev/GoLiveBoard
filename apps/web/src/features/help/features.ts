import { GLOSSARY } from "@/lib/glossary";

export interface Feature {
  readonly name: string;
  readonly what: string;
  /** Where it lives, in the words of the interface. */
  readonly where: string;
  /** Words people may search with. */
  readonly keywords: string;
}

export interface FeatureGroup {
  readonly id: string;
  readonly title: string;
  readonly features: readonly Feature[];
}

/**
 * Everything GoLiveBoard does, grouped by when it matters (docs/design/
 * learnability.md). Keep in step with docs/01: a feature missing here is
 * one a beginner will not find.
 */
export const FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    id: "before",
    title: "Before: get it ready",
    features: [
      {
        name: "Readiness score",
        what: GLOSSARY.readiness,
        where: "Event › Launch Control",
        keywords: "score blockers ready checklist",
      },
      {
        name: "Runbook",
        what: GLOSSARY.runbook,
        where: "Launch Control › Runbook",
        keywords: "tasks checklist critical owner due",
      },
      {
        name: "Who can register",
        what: GLOSSARY.accessPolicy,
        where: "Launch Control › Access policy",
        keywords: "access domain invite only public privacy",
      },
      {
        name: "Stream checks",
        what: "Your HLS link is checked every 30 seconds; while it fails, the event cannot go live.",
        where: "Launch Control › Stream",
        keywords: "stream hls mux url video outage",
      },
      {
        name: "Holding slate",
        what: GLOSSARY.holdingSlate,
        where: "Launch Control › Holding slate",
        keywords: "image picture waiting slate",
      },
      {
        name: "Invitations to an event",
        what: "For an invite-only event: only invited addresses can register.",
        where: "Launch Control › Audience",
        keywords: "invite email attendee",
      },
      {
        name: "Recurring events",
        what: "Create a series, then prepare each occurrence on its own.",
        where: "Events › New event",
        keywords: "series weekly repeat occurrence",
      },
    ],
  },
  {
    id: "during",
    title: "During: run it live",
    features: [
      {
        name: "Operations room",
        what: GLOSSARY.opsRoom,
        where: "Event › Operations room",
        keywords: "live dashboard viewers monitor",
      },
      {
        name: "Incidents",
        what: "A failed stream check while live opens one; it closes itself when the stream is back.",
        where: "Operations room",
        keywords: "outage alert incident stream down",
      },
      {
        name: "Chat and Q&A",
        what: "Attendees chat and ask; you can make questions wait for approval, answer or hide them.",
        where: "Launch Control › Chat and Q&A",
        keywords: "questions chat moderation approve",
      },
      {
        name: "AI triage",
        what: "Groups duplicate questions and flags urgent ones, within a daily budget.",
        where: "Chat and Q&A › Suggest groups",
        keywords: "ai claude group duplicate urgent",
      },
      {
        name: "Live polls",
        what: "Ask the whole audience a question with 2 to 6 answers; each attendee answers once and everyone sees the counts live.",
        where: "Launch Control › Chat and Q&A › Polls",
        keywords: "poll vote survey audience answer",
      },
    ],
  },
  {
    id: "after",
    title: "After: learn from it",
    features: [
      {
        name: "Report",
        what: "The audience over time, peak viewers and incidents, also as CSV.",
        where: "Event › Report",
        keywords: "report csv analytics audience peak",
      },
      {
        name: "Reports across events",
        what: "Completed events over a span compared: registrations, attendance, peaks, questions and incidents, month by month, also as CSV.",
        where: "Reports",
        keywords: "overview trends statistics analytics month compare csv",
      },
      {
        name: "Audit trail",
        what: "Every change, by whom and when.",
        where: "Audit trail",
        keywords: "history log changes who",
      },
    ],
  },
  {
    id: "workspace",
    title: "Your workspace",
    features: [
      {
        name: "Team and roles",
        what: "Owners manage everything; Managers run events; Analysts can only look.",
        where: "Team",
        keywords: "invite member role owner manager analyst",
      },
      {
        name: "Webhooks",
        what: "Signed messages (HMAC-SHA256) to your own systems when an event changes status.",
        where: "Integrations (Owners)",
        keywords: "webhook integration api signed hmac",
      },
      {
        name: "Attendee privacy",
        what: "Revoke an attendee's access, or erase them on request.",
        where: "Launch Control › Audience",
        keywords: "gdpr erase revoke privacy delete",
      },
    ],
  },
];

/** The features matching every word of `query`, by name, text or keyword. */
export function searchFeatures(query: string): FeatureGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...FEATURE_GROUPS];
  }
  return FEATURE_GROUPS.map((group) => ({
    ...group,
    features: group.features.filter((feature) => {
      const text =
        `${feature.name} ${feature.what} ${feature.where} ${feature.keywords}`.toLowerCase();
      return words.every((word) => text.includes(word));
    }),
  })).filter((group) => group.features.length > 0);
}
