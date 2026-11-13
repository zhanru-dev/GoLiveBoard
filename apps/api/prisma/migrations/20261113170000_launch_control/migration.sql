-- Launch Control (milestone 3): runbook, access policy, stream checks,
-- incidents, assets and the transactional outbox.

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TODO', 'DONE');

-- CreateEnum
CREATE TYPE "access_mode" AS ENUM ('PUBLIC', 'EMAIL_DOMAIN', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "incident_kind" AS ENUM ('STREAM_UNREACHABLE');

-- CreateEnum
CREATE TYPE "asset_kind" AS ENUM ('HOLDING_SLATE');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "stream_url" TEXT;

-- CreateTable
CREATE TABLE "runbook_tasks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "status" "task_status" NOT NULL DEFAULT 'TODO',
    "position" INTEGER NOT NULL,
    "owner_user_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runbook_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_policies" (
    "event_id" UUID NOT NULL,
    "mode" "access_mode" NOT NULL,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "privacy_notice_version" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_policies_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "stream_checks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "failure" TEXT,

    CONSTRAINT "stream_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "kind" "incident_kind" NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_id" UUID NOT NULL,
    "kind" "asset_kind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "asset_status" NOT NULL DEFAULT 'PENDING',
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "trace_context" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runbook_tasks_event_id_position_idx" ON "runbook_tasks"("event_id", "position");

-- CreateIndex
CREATE INDEX "runbook_tasks_owner_user_id_idx" ON "runbook_tasks"("owner_user_id");

-- CreateIndex
CREATE INDEX "runbook_tasks_completed_by_id_idx" ON "runbook_tasks"("completed_by_id");

-- CreateIndex
CREATE INDEX "stream_checks_event_id_checked_at_idx" ON "stream_checks"("event_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_event_id_opened_at_idx" ON "incidents"("event_id", "opened_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_open_key" ON "incidents"("event_id", "kind") WHERE ("resolved_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");

-- CreateIndex
CREATE INDEX "assets_event_id_kind_status_idx" ON "assets"("event_id", "kind", "status");

-- CreateIndex
CREATE INDEX "outbox_messages_undispatched_idx" ON "outbox_messages"("created_at") WHERE ("dispatched_at" IS NULL);

-- CreateIndex
CREATE INDEX "outbox_messages_workspace_id_idx" ON "outbox_messages"("workspace_id");

-- AddForeignKey
ALTER TABLE "runbook_tasks" ADD CONSTRAINT "runbook_tasks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_tasks" ADD CONSTRAINT "runbook_tasks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_tasks" ADD CONSTRAINT "runbook_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_policies" ADD CONSTRAINT "access_policies_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_checks" ADD CONSTRAINT "stream_checks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Positions start at 1; an access policy for EMAIL_DOMAIN names at least one
-- domain. The API checks both first; the constraints hold for every writer.
ALTER TABLE "runbook_tasks" ADD CONSTRAINT "runbook_tasks_position_positive" CHECK ("position" > 0);
ALTER TABLE "access_policies" ADD CONSTRAINT "access_policies_domains_match_mode"
  CHECK (("mode" = 'EMAIL_DOMAIN') = (cardinality("allowed_domains") > 0));
