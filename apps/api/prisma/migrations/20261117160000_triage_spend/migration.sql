-- What each workspace spends on AI triage per UK day, kept apart from the
-- runs (deleting events must not give the day's money back).
-- AlterTable
ALTER TABLE "triage_runs" ADD COLUMN     "merged_count" INTEGER,
ADD COLUMN     "reserved_micros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "spend_day" DATE;

-- CreateTable
CREATE TABLE "triage_spend" (
    "workspace_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "spent_micros" BIGINT NOT NULL DEFAULT 0,
    "reserved_micros" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "triage_spend_pkey" PRIMARY KEY ("workspace_id","day")
);

-- AddForeignKey
ALTER TABLE "triage_spend" ADD CONSTRAINT "triage_spend_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Runs made before the ledger: their day and cost go into it.
UPDATE "triage_runs"
SET "spend_day" = ("created_at" AT TIME ZONE 'Europe/London')::date;

INSERT INTO "triage_spend" ("workspace_id", "day", "runs", "spent_micros")
SELECT event."workspace_id", run."spend_day", count(*), coalesce(sum(run."cost_micros"), 0)
FROM "triage_runs" AS run
JOIN "events" AS event ON event."id" = run."event_id"
GROUP BY event."workspace_id", run."spend_day";

-- Decided before merges were counted: the count is unknown, recorded as 0.
UPDATE "triage_runs" SET "merged_count" = 0 WHERE "decision" <> 'PENDING';

ALTER TABLE "triage_spend"
  ADD CONSTRAINT "triage_spend_amounts"
    CHECK ("runs" >= 0 AND "spent_micros" >= 0 AND "reserved_micros" >= 0);

ALTER TABLE "triage_runs"
  ADD CONSTRAINT "triage_runs_reserved"
    CHECK ("reserved_micros" >= 0),
  ADD CONSTRAINT "triage_runs_merged_when_decided"
    CHECK (("decision" = 'PENDING') = ("merged_count" IS NULL) AND coalesce("merged_count", 0) >= 0);
