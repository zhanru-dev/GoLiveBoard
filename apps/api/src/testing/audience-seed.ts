import { randomUUID } from "node:crypto";

import type { TestDatabase } from "./database.js";

const HOUR_MS = 60 * 60 * 1000;

export interface SeededEvent {
  readonly workspaceId: string;
  readonly eventId: string;
  readonly slug: string;
}

/**
 * A workspace and an event written straight to the database, for worker
 * tests that need exact times (reminders, retention).
 */
export async function seedEvent(
  database: TestDatabase,
  options: {
    readonly startsAt: Date;
    readonly status?: string;
    readonly mode?: "PUBLIC" | "EMAIL_DOMAIN" | "INVITE_ONLY";
    readonly allowedDomains?: readonly string[];
    readonly retentionDays?: number;
    readonly workspaceId?: string;
  },
): Promise<SeededEvent> {
  const workspaceId = options.workspaceId ?? randomUUID();
  await database.query(
    `INSERT INTO workspaces (id, name, retention_days) VALUES ($1, 'Seeded', $2)
     ON CONFLICT (id) DO NOTHING`,
    [workspaceId, options.retentionDays ?? 90],
  );
  const slug = `seeded-${randomUUID().slice(0, 8)}`;
  const [event] = await database.query<{ id: string }>(
    `INSERT INTO events (workspace_id, slug, title, starts_at, ends_at, time_zone, status)
     VALUES ($1, $2, 'Seeded event', $3, $4, 'Europe/London', $5::event_status)
     RETURNING id`,
    [
      workspaceId,
      slug,
      options.startsAt,
      new Date(options.startsAt.getTime() + HOUR_MS),
      options.status ?? "READY",
    ],
  );
  await database.query(
    `INSERT INTO access_policies (event_id, mode, allowed_domains, privacy_notice_version)
     VALUES ($1, $2::access_mode, $3, '2026-11')`,
    [event?.id, options.mode ?? "PUBLIC", options.allowedDomains ?? []],
  );
  return { workspaceId, eventId: event?.id ?? "", slug };
}

/** An attendee written straight to the database; verified unless told. */
export async function seedAttendee(
  database: TestDatabase,
  eventId: string,
  options: {
    readonly email?: string;
    readonly status?: "PENDING" | "VERIFIED" | "REVOKED";
    readonly remindersOptIn?: boolean;
    readonly demoInboxKeyHash?: string;
  } = {},
): Promise<{ id: string; email: string }> {
  const email = options.email ?? `att-${randomUUID()}@example.com`;
  const status = options.status ?? "VERIFIED";
  const [row] = await database.query<{ id: string }>(
    `INSERT INTO attendees
       (event_id, email, name, consent_notice_version, consented_at,
        reminders_opt_in, status, verified_at, revoked_at, demo_inbox_key_hash)
     VALUES ($1, $2, 'Ada Lovelace', '2026-11', now(), $3, $4::attendee_status,
             CASE WHEN $4 = 'VERIFIED' THEN now() END,
             CASE WHEN $4 = 'REVOKED' THEN now() END, $5)
     RETURNING id`,
    [
      eventId,
      email,
      options.remindersOptIn ?? true,
      status,
      options.demoInboxKeyHash ?? null,
    ],
  );
  return { id: row?.id ?? "", email };
}
