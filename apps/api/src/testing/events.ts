import { EventDetail, RunbookTask } from "@goliveboard/contracts";

import {
  type ApiClient,
  TEST_PASSWORD,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "./api-client.js";
import type { TestDatabase } from "./database.js";
import type { CapturingMailer } from "./fakes.js";

export const LAUNCH = {
  title: "Product launch",
  description: "The autumn release.",
  startsAt: "2026-12-01T18:00:00Z",
  endsAt: "2026-12-01T19:30:00Z",
  timeZone: "Europe/London",
} as const;

/** Creates an event through the API; fails the test if that fails. */
export async function createEvent(
  api: ApiClient,
  session: TestSession,
  body: object = LAUNCH,
): Promise<EventDetail> {
  const response = await api.send(session, "post", "/events", body);
  if (response.status !== 201) {
    throw new Error(`Creating an event failed: ${response.text}`);
  }
  return EventDetail.parse(response.body);
}

/** A member of the owner's workspace with the given role, signed in. */
export async function memberOf(
  api: ApiClient,
  mailer: CapturingMailer,
  owner: TestSession,
  role: "MANAGER" | "ANALYST",
): Promise<TestSession> {
  const email = uniqueEmail(role.toLowerCase());
  await api.send(owner, "post", "/workspace/invitations", { email, role });
  const token = tokenFromEmail(mailer.to(email).at(-1)?.text ?? "");
  await api.post("/team-invitations/accept", {
    token,
    name: "Grace Hopper",
    password: TEST_PASSWORD,
  });
  return api.session(email);
}

export async function addTask(
  api: ApiClient,
  session: TestSession,
  eventId: string,
  body: object,
): Promise<RunbookTask> {
  const response = await api.send(
    session,
    "post",
    `/events/${eventId}/runbook-tasks`,
    body,
  );
  if (response.status !== 201) {
    throw new Error(`Adding a task failed: ${response.text}`);
  }
  return RunbookTask.parse(response.body);
}

/**
 * Removes every hard blocker of an event: a public access policy, a stream
 * that was just checked successfully, a ready holding slate, and a critical
 * task that is done. The stream check and slate are written directly, as the
 * worker and the upload would write them.
 */
export async function prepareForLaunch(
  api: ApiClient,
  database: TestDatabase,
  session: TestSession,
  eventId: string,
  checkedAt: Date,
): Promise<RunbookTask> {
  await api.send(session, "put", `/events/${eventId}/access-policy`, {
    mode: "PUBLIC",
    privacyNoticeVersion: "2026-11",
  });
  const streamUrl = "https://stream.example.com/index.m3u8";
  await database.query("UPDATE events SET stream_url = $2 WHERE id = $1", [
    eventId,
    streamUrl,
  ]);
  await database.query(
    `INSERT INTO stream_checks (event_id, url, slot, checked_at, ok, http_status, latency_ms)
     VALUES ($1, $2, $3, $3, true, 200, 120)`,
    [eventId, streamUrl, checkedAt],
  );
  await database.query(
    `INSERT INTO assets (event_id, kind, storage_key, status, content_type, size_bytes)
     VALUES ($1, 'HOLDING_SLATE', $2, 'READY', 'image/png', 1024)`,
    [eventId, `slates/${eventId}`],
  );
  const task = await addTask(api, session, eventId, {
    title: "Rehearse the opening",
    isCritical: true,
  });
  const done = await api
    .send(session, "patch", `/runbook-tasks/${task.id}`, { status: "DONE" })
    .set("If-Match", `"${String(task.version)}"`);
  return RunbookTask.parse(done.body);
}
