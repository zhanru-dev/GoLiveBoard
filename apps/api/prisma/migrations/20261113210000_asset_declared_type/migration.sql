-- Uploads declare their type and size before they start (both are signed
-- into the upload URL). Nothing has written assets yet, so no backfill.

-- AlterTable
ALTER TABLE "assets" ALTER COLUMN "content_type" SET NOT NULL,
ALTER COLUMN "size_bytes" SET NOT NULL;

