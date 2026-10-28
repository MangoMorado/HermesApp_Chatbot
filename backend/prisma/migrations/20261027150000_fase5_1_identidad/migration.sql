-- AlterTable
ALTER TABLE "widget_sessions" ADD COLUMN "secret_hash" TEXT;

-- CreateTable
CREATE TABLE "machine_credentials" (
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "secret_sealed" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "machine_credentials_pkey" PRIMARY KEY ("tenant_id","kind")
);

-- CreateTable
CREATE TABLE "closed_provider_sessions" (
    "sid" TEXT NOT NULL,
    "closed_until" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "closed_provider_sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "widget_sessions_secret_hash_key" ON "widget_sessions"("secret_hash");

-- AddForeignKey
ALTER TABLE "machine_credentials" ADD CONSTRAINT "machine_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
