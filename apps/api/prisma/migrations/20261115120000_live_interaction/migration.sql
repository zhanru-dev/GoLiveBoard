-- Milestone 6, live interaction (FR-RN-1 to FR-RN-5): chat messages,
-- questions and votes, the real-time journal, per-event sequence counters,
-- and attendance minutes. Written from `prisma migrate diff`, plus the
-- constraints and indexes at the end, which Prisma cannot express.


-- CreateEnum
CREATE TYPE "realtime_channel" AS ENUM ('CHAT', 'QUESTIONS');

-- CreateEnum
CREATE TYPE "question_status" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'ANSWERED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "chat_sequence" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "questions_pre_moderated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "questions_sequence" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "author_attendee_id" UUID,
    "author_user_id" UUID,
    "client_message_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "author_attendee_id" UUID,
    "author_user_id" UUID,
    "body" TEXT NOT NULL,
    "status" "question_status" NOT NULL,
    "pin_slot" SMALLINT,
    "merged_into_id" UUID,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_votes" (
    "question_id" UUID NOT NULL,
    "attendee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_votes_pkey" PRIMARY KEY ("question_id","attendee_id")
);

-- CreateTable
CREATE TABLE "realtime_journal" (
    "event_id" UUID NOT NULL,
    "channel" "realtime_channel" NOT NULL,
    "sequence" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_journal_pkey" PRIMARY KEY ("event_id","channel","sequence")
);

-- CreateTable
CREATE TABLE "attendance_minutes" (
    "event_id" UUID NOT NULL,
    "attendee_id" UUID NOT NULL,
    "minute" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_minutes_pkey" PRIMARY KEY ("event_id","attendee_id","minute")
);

-- CreateIndex
CREATE INDEX "chat_messages_author_attendee_id_idx" ON "chat_messages"("author_attendee_id");

-- CreateIndex
CREATE INDEX "chat_messages_author_user_id_idx" ON "chat_messages"("author_user_id");

-- CreateIndex
CREATE INDEX "chat_messages_deleted_by_id_idx" ON "chat_messages"("deleted_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_event_id_sequence_key" ON "chat_messages"("event_id", "sequence");

-- CreateIndex
CREATE INDEX "questions_event_id_status_vote_count_idx" ON "questions"("event_id", "status", "vote_count" DESC);

-- CreateIndex
CREATE INDEX "questions_author_attendee_id_idx" ON "questions"("author_attendee_id");

-- CreateIndex
CREATE INDEX "questions_author_user_id_idx" ON "questions"("author_user_id");

-- CreateIndex
CREATE INDEX "questions_merged_into_id_idx" ON "questions"("merged_into_id");

-- CreateIndex
CREATE INDEX "question_votes_attendee_id_idx" ON "question_votes"("attendee_id");

-- CreateIndex
CREATE INDEX "attendance_minutes_attendee_id_idx" ON "attendance_minutes"("attendee_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_attendee_id_fkey" FOREIGN KEY ("author_attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_author_attendee_id_fkey" FOREIGN KEY ("author_attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_journal" ADD CONSTRAINT "realtime_journal_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_minutes" ADD CONSTRAINT "attendance_minutes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_minutes" ADD CONSTRAINT "attendance_minutes_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An author is an attendee or a staff member, never both. (Both are empty
-- only if a staff member's account was deleted.)
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_one_author"
    CHECK ("author_attendee_id" IS NULL OR "author_user_id" IS NULL),
  -- FR-RN-3: a deleted message keeps no text.
  ADD CONSTRAINT "chat_messages_tombstone_has_no_text"
    CHECK ("deleted_at" IS NULL OR "body" = ''),
  ADD CONSTRAINT "chat_messages_body_length"
    CHECK (char_length("body") <= 1000),
  ADD CONSTRAINT "chat_messages_sequence_positive"
    CHECK ("sequence" > 0);

-- FR-RN-2: a retried send never duplicates. One client message ID per author
-- and event.
CREATE UNIQUE INDEX "chat_messages_client_key"
  ON "chat_messages" ("event_id", COALESCE("author_attendee_id", "author_user_id"), "client_message_id");

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_one_author"
    CHECK ("author_attendee_id" IS NULL OR "author_user_id" IS NULL),
  ADD CONSTRAINT "questions_body_length"
    CHECK (char_length("body") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "questions_vote_count_not_negative"
    CHECK ("vote_count" >= 0),
  -- FR-RN-5: at most 3 pinned questions, and only visible ones.
  ADD CONSTRAINT "questions_pin_slot_range"
    CHECK ("pin_slot" BETWEEN 1 AND 3),
  ADD CONSTRAINT "questions_pinned_are_visible"
    CHECK ("pin_slot" IS NULL OR "status" IN ('PUBLISHED', 'ANSWERED'));

CREATE UNIQUE INDEX "questions_pin_slot_key"
  ON "questions" ("event_id", "pin_slot") WHERE "pin_slot" IS NOT NULL;

ALTER TABLE "realtime_journal"
  ADD CONSTRAINT "realtime_journal_sequence_positive" CHECK ("sequence" > 0);

ALTER TABLE "events"
  ADD CONSTRAINT "events_sequences_not_negative"
    CHECK ("chat_sequence" >= 0 AND "questions_sequence" >= 0);
