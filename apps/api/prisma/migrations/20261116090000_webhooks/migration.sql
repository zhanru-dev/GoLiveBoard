-- Milestone 7: webhook endpoints, deliveries and their attempts (FR-RC-2),
-- and whether attendee.registered webhooks carry personal data. Written from
-- `prisma migrate diff`, plus the constraints at the end.


-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "webhooks_include_personal_data" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "event_types" TEXT[],
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_key_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "delivery_id" UUID NOT NULL,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL,
    "status_code" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "error" TEXT,

    CONSTRAINT "webhook_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_workspace_id_idx" ON "webhook_endpoints"("workspace_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries"("next_attempt_at") WHERE ("status" = 'PENDING');

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_id_key" ON "webhook_deliveries"("endpoint_id", "event_id");

-- CreateIndex
CREATE INDEX "webhook_attempts_delivery_id_attempted_at_idx" ON "webhook_attempts"("delivery_id", "attempted_at");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_endpoints"
  -- docs/04 section 6.1: targets must be https.
  ADD CONSTRAINT "webhook_endpoints_https" CHECK ("url" LIKE 'https://%'),
  ADD CONSTRAINT "webhook_endpoints_url_length" CHECK (char_length("url") <= 2048),
  ADD CONSTRAINT "webhook_endpoints_event_types" CHECK (cardinality("event_types") >= 1),
  ADD CONSTRAINT "webhook_endpoints_description_length" CHECK (char_length("description") <= 200);

ALTER TABLE "webhook_deliveries"
  -- Up to 5 attempts in all (docs/04 section 6.1).
  ADD CONSTRAINT "webhook_deliveries_attempts" CHECK ("attempts" BETWEEN 0 AND 5),
  -- A pending delivery always knows when to try next; a finished one never.
  ADD CONSTRAINT "webhook_deliveries_next_attempt" CHECK (
    ("status" = 'PENDING') = ("next_attempt_at" IS NOT NULL)
  );
