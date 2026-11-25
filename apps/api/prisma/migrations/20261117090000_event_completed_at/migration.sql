-- Whether an event ever completed (FR-RC-3), kept for good: archiving an
-- event keeps it, and the audit trail it was read from is deleted after
-- two years.
-- AlterTable
ALTER TABLE "events" ADD COLUMN     "completed_at" TIMESTAMPTZ(3);

-- Events completed before this column: when the audit trail says they
-- completed...
UPDATE "events" AS event
SET "completed_at" = completion.at
FROM (
  SELECT "event_id", min("created_at") AS at
  FROM "audit_entries"
  WHERE "action" = 'event.transitioned' AND "after" ->> 'status' = 'COMPLETED'
  GROUP BY "event_id"
) AS completion
WHERE event."id" = completion."event_id"
  AND event."status" IN ('COMPLETED', 'ARCHIVED');

-- ...and otherwise for those still completed, or with a stored report.
UPDATE "events" AS event
SET "completed_at" = COALESCE(
  (SELECT report."generated_at" FROM "event_reports" AS report
   WHERE report."event_id" = event."id"),
  event."updated_at"
)
WHERE event."completed_at" IS NULL
  AND (
    event."status" = 'COMPLETED'
    OR (
      event."status" = 'ARCHIVED'
      AND EXISTS (SELECT 1 FROM "event_reports" AS report WHERE report."event_id" = event."id")
    )
  );

-- Only an event that completed (and perhaps was archived since) has one.
ALTER TABLE "events" ADD CONSTRAINT "events_completed_at_status"
  CHECK ("completed_at" IS NULL OR "status" IN ('COMPLETED', 'ARCHIVED'));
