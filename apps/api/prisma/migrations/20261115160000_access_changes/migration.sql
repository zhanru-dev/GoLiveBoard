-- Milestone 6 review: changes to who may take part in live interaction are
-- written in the transaction that makes them, and every API instance reads
-- them every second (FR-AD-4 within 5 seconds, without depending on a
-- message broker). And when a question was first public, so a change to one
-- that never was reaches others without its ID.


-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "first_published_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "access_changes" (
    "id" BIGSERIAL NOT NULL,
    "change" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_changes_created_at_idx" ON "access_changes"("created_at");

-- Questions that are or may have been public keep sending their ID: a
-- hidden one may have been published before this column existed.
UPDATE "questions" SET "first_published_at" = "created_at"
WHERE "status" IN ('PUBLISHED', 'ANSWERED', 'HIDDEN');
