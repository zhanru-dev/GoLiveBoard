-- Milestone 5, admission (FR-AD-1 to FR-AD-6): attendees and their
-- invitations, verification links, sessions, reminders, and the demo inbox.
-- Written from `prisma migrate diff`, plus the CHECK constraints at the end,
-- which Prisma cannot express.


-- CreateEnum
CREATE TYPE "attendee_status" AS ENUM ('PENDING', 'VERIFIED', 'REVOKED', 'ERASED');

-- CreateEnum
CREATE TYPE "reminder_kind" AS ENUM ('DAY_BEFORE', 'HOUR_BEFORE');

-- CreateTable
CREATE TABLE "attendees" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "attendee_status" NOT NULL DEFAULT 'PENDING',
    "consent_notice_version" TEXT NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "reminders_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "erased_at" TIMESTAMPTZ(3),
    "demo_inbox_key_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendee_invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "invited_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendee_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendee_verification_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "attendee_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendee_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendee_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "attendee_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendee_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "attendee_id" UUID NOT NULL,
    "kind" "reminder_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("attendee_id","kind")
);

-- CreateTable
CREATE TABLE "demo_inbox_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "attendee_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendees_event_id_status_idx" ON "attendees"("event_id", "status");

-- CreateIndex
CREATE INDEX "attendees_demo_inbox_key_hash_idx" ON "attendees"("demo_inbox_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "attendees_event_id_email_key" ON "attendees"("event_id", "email");

-- CreateIndex
CREATE INDEX "attendee_invitations_event_id_idx" ON "attendee_invitations"("event_id");

-- CreateIndex
CREATE INDEX "attendee_invitations_invited_by_id_idx" ON "attendee_invitations"("invited_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendee_invitations_live_key" ON "attendee_invitations"("event_id", "email") WHERE ("revoked_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "attendee_verification_tokens_token_hash_key" ON "attendee_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "attendee_verification_tokens_attendee_id_idx" ON "attendee_verification_tokens"("attendee_id");

-- CreateIndex
CREATE INDEX "attendee_verification_tokens_expires_at_idx" ON "attendee_verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendee_sessions_token_hash_key" ON "attendee_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "attendee_sessions_attendee_id_idx" ON "attendee_sessions"("attendee_id");

-- CreateIndex
CREATE INDEX "attendee_sessions_expires_at_idx" ON "attendee_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "demo_inbox_messages_attendee_id_created_at_idx" ON "demo_inbox_messages"("attendee_id", "created_at");

-- AddForeignKey
ALTER TABLE "attendees" ADD CONSTRAINT "attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendee_invitations" ADD CONSTRAINT "attendee_invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendee_invitations" ADD CONSTRAINT "attendee_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendee_verification_tokens" ADD CONSTRAINT "attendee_verification_tokens_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendee_sessions" ADD CONSTRAINT "attendee_sessions_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_inbox_messages" ADD CONSTRAINT "demo_inbox_messages_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An attendee's status and its timestamps agree.
ALTER TABLE "attendees"
  ADD CONSTRAINT "attendees_verified_has_time"
    CHECK ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL),
  ADD CONSTRAINT "attendees_revoked_has_time"
    CHECK ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL),
  ADD CONSTRAINT "attendees_erased_matches_status"
    CHECK (("status" = 'ERASED') = ("erased_at" IS NOT NULL));
