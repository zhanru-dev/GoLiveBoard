-- Live polls (FR-RN-8, docs/design/polls.md).
CREATE TYPE "poll_status" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

CREATE TABLE "polls" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "status" "poll_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "polls_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "polls_question_length" CHECK (char_length("question") BETWEEN 1 AND 200),
    -- An open poll has opened; a closed one has also closed.
    CONSTRAINT "polls_times_match_status" CHECK (
      ("status" = 'DRAFT' AND "opened_at" IS NULL AND "closed_at" IS NULL)
      OR ("status" = 'OPEN' AND "opened_at" IS NOT NULL AND "closed_at" IS NULL)
      OR ("status" = 'CLOSED' AND "opened_at" IS NOT NULL AND "closed_at" IS NOT NULL)
    )
);

CREATE INDEX "polls_event_id_created_at_idx" ON "polls"("event_id", "created_at");

-- At most one open poll per event.
CREATE UNIQUE INDEX "polls_one_open_per_event" ON "polls"("event_id") WHERE "status" = 'OPEN';

CREATE TABLE "poll_options" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "poll_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "label" TEXT NOT NULL,
    "vote_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "poll_options_position_range" CHECK ("position" BETWEEN 1 AND 6),
    CONSTRAINT "poll_options_label_length" CHECK (char_length("label") BETWEEN 1 AND 80),
    CONSTRAINT "poll_options_vote_count_nonnegative" CHECK ("vote_count" >= 0)
);

CREATE UNIQUE INDEX "poll_options_poll_id_position_key" ON "poll_options"("poll_id", "position");
CREATE UNIQUE INDEX "poll_options_id_poll_id_key" ON "poll_options"("id", "poll_id");

CREATE TABLE "poll_votes" (
    "poll_id" UUID NOT NULL,
    "attendee_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("poll_id", "attendee_id"),
    CONSTRAINT "poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "poll_votes_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- The option must be one of this poll's.
    CONSTRAINT "poll_votes_option_id_poll_id_fkey" FOREIGN KEY ("option_id", "poll_id") REFERENCES "poll_options"("id", "poll_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "poll_votes_attendee_id_idx" ON "poll_votes"("attendee_id");
CREATE INDEX "poll_votes_option_id_poll_id_idx" ON "poll_votes"("option_id", "poll_id");
