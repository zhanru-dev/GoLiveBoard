-- What the post-event report keeps of the attendance minutes (FR-RC-3).
-- CreateTable
CREATE TABLE "event_reports" (
    "event_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "event_reports_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "event_reports_generated_at_idx" ON "event_reports"("generated_at");

-- AddForeignKey
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A JSON object, as the API writes it.
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_data_object" CHECK (jsonb_typeof("data") = 'object');
