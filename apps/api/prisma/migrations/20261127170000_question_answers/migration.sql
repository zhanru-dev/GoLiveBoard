-- A moderator's written answer to a question (FR-RN-5).
ALTER TABLE "questions"
  ADD COLUMN "answer" TEXT,
  ADD COLUMN "answered_at" TIMESTAMPTZ(3);

-- Only an answered question carries an answer: the domain enforces it
-- (planModeration). Its CHECK waits for the next release: the version
-- before this one reopens a question by its status alone, and must keep
-- working on this schema if a release rolls back (expand and contract,
-- docs/06, section 4). These two involve only the new columns.
ALTER TABLE "questions"
  ADD CONSTRAINT "questions_answer_has_time"
    CHECK (("answer" IS NULL) = ("answered_at" IS NULL)),
  ADD CONSTRAINT "questions_answer_length"
    CHECK (char_length("answer") BETWEEN 1 AND 2000);
