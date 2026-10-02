-- CreateEnum
CREATE TYPE "conversation_message_author" AS ENUM ('bot', 'patient');

-- CreateEnum
CREATE TYPE "handoff_reason" AS ENUM ('requested', 'verification_locked', 'unverifiable');

-- CreateEnum
CREATE TYPE "handoff_status" AS ENUM ('open');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "widget_session_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "medical_record_id" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "author" "conversation_message_author" NOT NULL,
    "text" TEXT NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_challenges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "medical_record_id" TEXT NOT NULL,
    "question_ids" TEXT[],
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "reason" "handoff_reason" NOT NULL,
    "status" "handoff_status" NOT NULL DEFAULT 'open',
    "medical_record_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "handoff_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_id_key" ON "conversations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_widget_session_id_key" ON "conversations"("tenant_id", "widget_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_tenant_id_conversation_id_seq_key" ON "conversation_messages"("tenant_id", "conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "verification_challenges_tenant_id_medical_record_id_key" ON "verification_challenges"("tenant_id", "medical_record_id");

-- CreateIndex
CREATE INDEX "handoff_tickets_tenant_id_status_created_at_idx" ON "handoff_tickets"("tenant_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_widget_session_id_fkey" FOREIGN KEY ("tenant_id", "widget_session_id") REFERENCES "widget_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_medical_record_id_fkey" FOREIGN KEY ("tenant_id", "medical_record_id") REFERENCES "medical_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_tenant_id_medical_record_id_fkey" FOREIGN KEY ("tenant_id", "medical_record_id") REFERENCES "medical_records"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_tickets" ADD CONSTRAINT "handoff_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_tickets" ADD CONSTRAINT "handoff_tickets_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_tickets" ADD CONSTRAINT "handoff_tickets_tenant_id_medical_record_id_fkey" FOREIGN KEY ("tenant_id", "medical_record_id") REFERENCES "medical_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa.
ALTER TABLE "public"."verification_challenges"
  ADD CONSTRAINT "verification_challenges_question_pair" CHECK (cardinality("question_ids") = 2),
  ADD CONSTRAINT "verification_challenges_failed_attempts_nonneg" CHECK ("failed_attempts" >= 0);

ALTER TABLE "public"."conversation_messages"
  ADD CONSTRAINT "conversation_messages_redacted_text" CHECK (NOT "redacted" OR "text" = '[redactado]');

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_message_count_nonneg" CHECK ("message_count" >= 0);

-- CORS: buscar un origen entre los permitidos de cualquier tenant.
CREATE INDEX "bot_configs_allowed_origins_gin" ON "public"."bot_configs" USING GIN ("allowed_origins");
