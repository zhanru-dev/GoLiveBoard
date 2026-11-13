import type { Actor } from "../auth/actor.js";
import type { Prisma } from "../generated/prisma/client.js";

/** What happened, to which record, and how it changed (FR-RC-1). */
export interface AuditRecord {
  /** `<target>.<verb>`, e.g. "event.created". */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  /** The event the change belongs to, so an event's history can be searched. */
  readonly eventId?: string;
  /** Only the fields that changed. Never secrets or attendee email addresses. */
  readonly before?: Prisma.InputJsonValue;
  readonly after?: Prisma.InputJsonValue;
}

/**
 * Records a staff member's action. Takes the transaction client on purpose:
 * the entry commits or rolls back together with the change it describes, so
 * the audit trail can never claim something that did not happen, or miss
 * something that did.
 */
export async function recordAudit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  record: AuditRecord,
): Promise<void> {
  await tx.auditEntry.create({
    data: {
      workspaceId: actor.workspaceId,
      actorKind: "USER",
      actorUserId: actor.userId,
      requestId: actor.requestId,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      eventId: record.eventId ?? null,
      ...(record.before !== undefined && { before: record.before }),
      ...(record.after !== undefined && { after: record.after }),
    },
  });
}
