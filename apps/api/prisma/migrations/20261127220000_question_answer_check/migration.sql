-- The contract step for written answers (FR-RN-5): only an answered
-- question carries one. It waited one release (20261127170000): the
-- release before written answers reopened questions by status alone.
-- Every release that can run now, the one a rollback returns to
-- included, clears the answer when it reopens a question (docs/06,
-- section 4).

-- None should exist; one would stop the constraint, and the deploy.
UPDATE "questions"
   SET "answer" = NULL, "answered_at" = NULL
 WHERE "answer" IS NOT NULL AND "status" <> 'ANSWERED';

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_answer_only_when_answered"
    CHECK ("answer" IS NULL OR "status" = 'ANSWERED');
