import { z } from "zod";

import { PageQuery, pageOf } from "./pagination.js";

/** `GET /audit-entries` (FR-RC-1): every filter optional, newest first. */
export const AuditQuery = PageQuery.extend({
  eventId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  /** `<target>.<verb>`, e.g. `event.transitioned`. */
  action: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .max(64)
    .optional(),
  /** From this instant, inclusive. */
  from: z.iso.datetime().optional(),
  /** Before this instant, exclusive. */
  to: z.iso.datetime().optional(),
}).refine(
  (query) =>
    query.from === undefined ||
    query.to === undefined ||
    Date.parse(query.from) < Date.parse(query.to),
  { path: ["to"], error: "Must be after from" },
);
export type AuditQuery = z.infer<typeof AuditQuery>;

/** One audited action: who, what, when, before and after. */
export const AuditEntry = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  actor: z.object({
    kind: z.enum(["USER", "ATTENDEE", "SYSTEM"]),
    /** Null for SYSTEM, and for a user whose account no longer exists. */
    userId: z.uuid().nullable(),
    name: z.string().nullable(),
  }),
  action: z.string(),
  targetType: z.string(),
  targetId: z.uuid(),
  eventId: z.uuid().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  /** Correlates the entry with the request's logs. */
  requestId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditPage = pageOf(AuditEntry);
export type AuditPage = z.infer<typeof AuditPage>;
