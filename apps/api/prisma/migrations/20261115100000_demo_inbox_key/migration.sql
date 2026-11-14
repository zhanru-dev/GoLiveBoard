-- Each demo inbox message records the inbox it was written to, so a later
-- registration of the same address from another browser cannot read it.
-- Nothing has written demo inbox messages yet, so the column needs no
-- default.

-- DropIndex
DROP INDEX "demo_inbox_messages_attendee_id_created_at_idx";

-- AlterTable
ALTER TABLE "demo_inbox_messages" ADD COLUMN "inbox_key_hash" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "demo_inbox_messages_attendee_id_idx" ON "demo_inbox_messages"("attendee_id");

-- CreateIndex
CREATE INDEX "demo_inbox_messages_inbox_key_hash_created_at_idx" ON "demo_inbox_messages"("inbox_key_hash", "created_at");
