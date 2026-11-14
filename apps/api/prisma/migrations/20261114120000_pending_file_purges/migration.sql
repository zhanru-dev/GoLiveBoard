-- Files the demo reset could not be sure of deleting (milestone 4 review):
-- each row is a storage prefix to empty once its upload links have expired.
-- The maintenance sweep keeps trying until it succeeds.

-- CreateTable
CREATE TABLE "pending_file_purges" (
    "prefix" TEXT NOT NULL,
    "not_before" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_file_purges_pkey" PRIMARY KEY ("prefix")
);

-- CreateIndex
CREATE INDEX "pending_file_purges_not_before_idx" ON "pending_file_purges"("not_before");
