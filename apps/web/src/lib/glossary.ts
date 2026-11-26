/**
 * The product's own words, explained once (docs/design/learnability.md):
 * shown where a term first appears, and on the help page.
 */
export const GLOSSARY = {
  readiness:
    "How prepared an event is, out of 100, from six criteria. Hard blockers stop it being marked ready or going live; the rest only add points.",
  blocker:
    "A criterion that must pass before the event can be marked ready or go live: an access policy, a reachable stream, every critical task done, a holding slate.",
  runbook:
    "The event's checklist: tasks with owners and due dates. A critical task blocks Ready and Live until it is done.",
  holdingSlate:
    "The image attendees see on the watch page until the event goes live. JPEG, PNG or WebP, up to 5 MB.",
  accessPolicy:
    "Who may register for the event: anyone, people with an address at given email domains, or invited people only.",
  opsRoom:
    "The live view of an event: viewers, chat and question rates, incidents and a timeline, updated in real time.",
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;
