-- Only the newest unanswered invitation per address and workspace may work.
-- Concurrent requests could leave several open (the milestone 2 review), so
-- revoke all but the newest before the index makes that impossible.
UPDATE "team_invitations" AS older
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE older."accepted_at" IS NULL
  AND older."revoked_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "team_invitations" AS newer
    WHERE newer."workspace_id" = older."workspace_id"
      AND newer."email" = older."email"
      AND newer."accepted_at" IS NULL
      AND newer."revoked_at" IS NULL
      AND (newer."created_at", newer."id") > (older."created_at", older."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_open_key" ON "team_invitations"("workspace_id", "email") WHERE ("accepted_at" IS NULL AND "revoked_at" IS NULL);
