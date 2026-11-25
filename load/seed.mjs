/**
 * Seeds a load test (NFR-4): one live public event and its verified
 * attendees, each with a session, written straight to the database. Prints
 * the SQL; writes the slug and the session tokens to out/session.json for
 * k6. Nothing personal: names and addresses are made up.
 *
 *   node load/seed.mjs 500 > seed.sql
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const count = Number(process.argv[2] ?? "500");
if (!Number.isInteger(count) || count < 1 || count > 5000) {
  throw new Error("Give the number of attendees, 1 to 5000");
}

const workspaceId = randomUUID();
const eventId = randomUUID();
const slug = `load-test-${randomUUID().slice(0, 8)}`;
const quote = (text) => `'${text.replaceAll("'", "''")}'`;
const tokens = [];
const rows = [];
for (let n = 0; n < count; n += 1) {
  const attendeeId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  tokens.push(token);
  const hash = createHash("sha256").update(token).digest("hex");
  rows.push(
    `(${quote(attendeeId)}, ${quote(eventId)}, ${quote(`attendee-${String(n)}@load.test`)}, ${quote(`Attendee ${String(n)}`)}, ${quote(hash)})`,
  );
}

const sql = `
BEGIN;
INSERT INTO workspaces (id, name) VALUES (${quote(workspaceId)}, 'Load test');
INSERT INTO events (id, workspace_id, slug, title, starts_at, ends_at, time_zone, status)
VALUES (${quote(eventId)}, ${quote(workspaceId)}, ${quote(slug)}, 'Load test',
        now() - interval '10 minutes', now() + interval '2 hours', 'Europe/London', 'LIVE');
INSERT INTO access_policies (event_id, mode, allowed_domains, privacy_notice_version)
VALUES (${quote(eventId)}, 'PUBLIC', '{}', '2026-11');
WITH seeded (id, event_id, email, name, token_hash) AS (VALUES
${rows.join(",\n")}
), attendees AS (
  INSERT INTO attendees (id, event_id, email, name, consent_notice_version, consented_at, status, verified_at)
  SELECT id::uuid, event_id::uuid, email, name, '2026-11', now(), 'VERIFIED', now() FROM seeded
  RETURNING id
)
INSERT INTO attendee_sessions (attendee_id, token_hash, expires_at)
SELECT id::uuid, token_hash, now() + interval '1 day' FROM seeded;
COMMIT;
`;

const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("session.json", out), JSON.stringify({ slug, tokens }));
process.stdout.write(sql);
