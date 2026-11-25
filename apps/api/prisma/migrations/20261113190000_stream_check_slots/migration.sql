-- Stream checks remember the URL they checked and the slot they were
-- scheduled for. Nothing has written stream checks yet, so the table is empty
-- and the NOT NULL columns need no default.

-- AlterTable
ALTER TABLE "stream_checks" ADD COLUMN     "slot" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "url" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "stream_checks_event_id_slot_key" ON "stream_checks"("event_id", "slot");

