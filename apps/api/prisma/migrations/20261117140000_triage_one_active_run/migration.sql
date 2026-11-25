-- One triage run at a time per event: a second request while one is queued
-- or running gets that one.
-- CreateIndex
CREATE UNIQUE INDEX "triage_runs_one_active_key" ON "triage_runs"("event_id") WHERE (status IN ('QUEUED', 'RUNNING'));
