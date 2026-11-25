-- An earlier build recorded the events a demo reset deleted as outbox
-- messages ("demo.events_deleted"), whose purge job gave up after its last
-- retry. Record their storage prefixes for the sweep, so an upgrade loses
-- none of them (milestone 4 review, round 3). Each prefix becomes due when
-- the upload links handed out before that reset had expired: 5 minutes of
-- link lifetime plus a 5-minute margin, as PURGE_DELAY_MS. A prefix already
-- recorded keeps its record, so running this again changes nothing.

INSERT INTO "pending_file_purges" ("prefix", "not_before")
SELECT prefix.value, message."created_at" + INTERVAL '10 minutes'
FROM "outbox_messages" AS message
CROSS JOIN LATERAL jsonb_array_elements_text(message."payload" -> 'eventIds') AS event(id)
CROSS JOIN LATERAL (
  VALUES ('events/' || event.id || '/'), ('uploads/events/' || event.id || '/')
) AS prefix(value)
WHERE message."type" = 'demo.events_deleted'
  AND jsonb_typeof(message."payload" -> 'eventIds') = 'array'
ON CONFLICT ("prefix") DO NOTHING;
