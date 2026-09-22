-- CreateTable
CREATE TABLE "bot_configs" (
    "tenant_id" TEXT NOT NULL,
    "texts" JSONB NOT NULL DEFAULT '{}',
    "params" JSONB NOT NULL DEFAULT '{}',
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bot_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "widget_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "grace_until" TIMESTAMPTZ(3),

    CONSTRAINT "widget_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "detail" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widget_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "widget_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_idempotency_keys" (
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "widget_keys_key_key" ON "widget_keys"("key");

-- CreateIndex
CREATE INDEX "widget_keys_tenant_id_idx" ON "widget_keys"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_entries_tenant_id_category_position_idx" ON "knowledge_entries"("tenant_id", "category", "position");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entries_tenant_id_id_key" ON "knowledge_entries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "widget_sessions_tenant_id_id_key" ON "widget_sessions"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_keys" ADD CONSTRAINT "widget_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una sola clave vigente por tenant: dos rotaciones concurrentes no pueden dejar dos.
CREATE UNIQUE INDEX "widget_keys_one_current_per_tenant" ON "widget_keys"("tenant_id") WHERE "retired_at" IS NULL;

-- La gracia solo tiene sentido en una clave retirada.
ALTER TABLE "widget_keys"
  ADD CONSTRAINT "widget_keys_grace_check" CHECK ("grace_until" IS NULL OR "retired_at" IS NOT NULL);

ALTER TABLE "knowledge_entries"
  ADD CONSTRAINT "knowledge_entries_position_check" CHECK ("position" >= 0);

ALTER TABLE "widget_sessions"
  ADD CONSTRAINT "widget_sessions_expiry_check" CHECK ("expires_at" > "created_at");
