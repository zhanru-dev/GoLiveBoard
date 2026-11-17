-- AI question triage runs (FR-RN-6, ADR-0012).
-- CreateEnum
CREATE TYPE "triage_run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "triage_decision" AS ENUM ('PENDING', 'ACCEPTED', 'PARTIAL', 'REJECTED');

-- CreateTable
CREATE TABLE "triage_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "status" "triage_run_status" NOT NULL DEFAULT 'QUEUED',
    "question_ids" UUID[],
    "suggestions" JSONB,
    "failure" TEXT,
    "model" TEXT,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_micros" INTEGER,
    "decision" "triage_decision" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "triage_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "triage_runs_event_id_created_at_idx" ON "triage_runs"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "triage_runs_created_at_idx" ON "triage_runs"("created_at");

-- CreateIndex
CREATE INDEX "triage_runs_requested_by_id_idx" ON "triage_runs"("requested_by_id");

-- CreateIndex
CREATE INDEX "triage_runs_decided_by_id_idx" ON "triage_runs"("decided_by_id");

-- AddForeignKey
ALTER TABLE "triage_runs" ADD CONSTRAINT "triage_runs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_runs" ADD CONSTRAINT "triage_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_runs" ADD CONSTRAINT "triage_runs_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A run's state is consistent whatever writes it.
ALTER TABLE "triage_runs"
  ADD CONSTRAINT "triage_runs_question_ids"
    CHECK ("question_ids" IS NOT NULL AND cardinality("question_ids") BETWEEN 1 AND 200),
  ADD CONSTRAINT "triage_runs_suggestions_when_succeeded"
    CHECK (("status" = 'SUCCEEDED') = ("suggestions" IS NOT NULL)),
  ADD CONSTRAINT "triage_runs_failure_when_failed"
    CHECK (("status" IN ('FAILED', 'TIMED_OUT')) = ("failure" IS NOT NULL)),
  ADD CONSTRAINT "triage_runs_finished_when_done"
    CHECK (("status" IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT')) = ("finished_at" IS NOT NULL)),
  ADD CONSTRAINT "triage_runs_decided_when_succeeded"
    CHECK ("decision" = 'PENDING' OR ("status" = 'SUCCEEDED' AND "decided_at" IS NOT NULL)),
  ADD CONSTRAINT "triage_runs_counts"
    CHECK (
      coalesce("latency_ms", 0) >= 0
      AND coalesce("input_tokens", 0) >= 0
      AND coalesce("output_tokens", 0) >= 0
      AND coalesce("cost_micros", 0) >= 0
    );
