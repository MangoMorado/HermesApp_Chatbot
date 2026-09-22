-- CreateEnum
CREATE TYPE "slot_status" AS ENUM ('free', 'busy', 'busy_tentative', 'busy_unavailable');

-- CreateEnum
CREATE TYPE "medical_record_status" AS ENUM ('active', 'pre_registered');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('booked', 'cancelled', 'fulfilled', 'noshow');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('CC', 'TI', 'CE', 'PA', 'RC');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_query_range_days" INTEGER NOT NULL DEFAULT 31,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "healthcare_services" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "healthcare_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "practitioner_id" TEXT NOT NULL,
    "healthcare_service_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "slot_status" NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "document_type" "document_type" NOT NULL,
    "document_number" TEXT NOT NULL,
    "given_names" TEXT NOT NULL,
    "family_names" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" "medical_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "medical_record_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "appointment_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_subject" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actor_subject" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_id_key" ON "practitioners"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_identifier_system_identifier_value_key" ON "practitioners"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_services_tenant_id_id_key" ON "healthcare_services"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_services_tenant_id_identifier_system_identifier__key" ON "healthcare_services"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_id_key" ON "schedules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_identifier_system_identifier_value_key" ON "schedules"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE INDEX "slots_tenant_id_schedule_id_start_at_idx" ON "slots"("tenant_id", "schedule_id", "start_at");

-- CreateIndex
CREATE INDEX "slots_tenant_id_status_start_at_idx" ON "slots"("tenant_id", "status", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "slots_tenant_id_id_key" ON "slots"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "slots_tenant_id_identifier_system_identifier_value_key" ON "slots"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_tenant_id_id_key" ON "medical_records"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_tenant_id_identifier_system_identifier_valu_key" ON "medical_records"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_tenant_id_document_type_document_number_key" ON "medical_records"("tenant_id", "document_type", "document_number");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_medical_record_id_start_at_idx" ON "appointments"("tenant_id", "medical_record_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_schedule_id_start_at_idx" ON "appointments"("tenant_id", "schedule_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_identifier_system_identifier_value_key" ON "appointments"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healthcare_services" ADD CONSTRAINT "healthcare_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_healthcare_service_id_fkey" FOREIGN KEY ("tenant_id", "healthcare_service_id") REFERENCES "healthcare_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_medical_record_id_fkey" FOREIGN KEY ("tenant_id", "medical_record_id") REFERENCES "medical_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_slot_id_fkey" FOREIGN KEY ("tenant_id", "slot_id") REFERENCES "slots"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa en el schema.
ALTER TABLE "public"."tenants"
  ADD CONSTRAINT "tenants_max_query_range_days_check"
  CHECK ("max_query_range_days" BETWEEN 1 AND 366);

ALTER TABLE "public"."slots"
  ADD CONSTRAINT "slots_time_range_check" CHECK ("end_at" > "start_at");

ALTER TABLE "public"."appointments"
  ADD CONSTRAINT "appointments_time_range_check" CHECK ("end_at" > "start_at");
