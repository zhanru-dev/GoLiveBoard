-- A moderator's written answer to a question (FR-RN-5).
ALTER TABLE "questions"
  ADD COLUMN "answer" TEXT,
  ADD COLUMN "answered_at" TIMESTAMPTZ(3);

-- Only an answered question carries an answer, so reopening one cannot
-- leave a stale answer showing.
ALTER TABLE "questions"
  ADD CONSTRAINT "questions_answer_only_when_answered"
    CHECK ("answer" IS NULL OR "status" = 'ANSWERED'),
  ADD CONSTRAINT "questions_answer_has_time"
    CHECK (("answer" IS NULL) = ("answered_at" IS NULL)),
  ADD CONSTRAINT "questions_answer_length"
    CHECK (char_length("answer") BETWEEN 1 AND 2000);
