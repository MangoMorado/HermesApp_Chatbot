-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hermes_sim";

-- CreateEnum
CREATE TYPE "hermes_sim"."slot_status" AS ENUM ('free', 'busy', 'busy_tentative', 'busy_unavailable');

-- CreateEnum
CREATE TYPE "hermes_sim"."patient_status" AS ENUM ('active', 'pre_registered');

-- CreateEnum
CREATE TYPE "hermes_sim"."appointment_status" AS ENUM ('booked', 'cancelled', 'fulfilled', 'noshow');

-- CreateEnum
CREATE TYPE "hermes_sim"."document_type" AS ENUM ('CC', 'TI', 'CE', 'PA', 'RC');

-- CreateTable
CREATE TABLE "hermes_sim"."practitioners" (
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
CREATE TABLE "hermes_sim"."healthcare_services" (
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
CREATE TABLE "hermes_sim"."schedules" (
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
CREATE TABLE "hermes_sim"."slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "hermes_sim"."slot_status" NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hermes_sim"."patients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "document_type" "hermes_sim"."document_type" NOT NULL,
    "document_number" TEXT NOT NULL,
    "given_names" TEXT NOT NULL,
    "family_names" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" "hermes_sim"."patient_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hermes_sim"."appointments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_system" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "hermes_sim"."appointment_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_id_key" ON "hermes_sim"."practitioners"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_tenant_id_identifier_system_identifier_value_key" ON "hermes_sim"."practitioners"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_services_tenant_id_id_key" ON "hermes_sim"."healthcare_services"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_services_tenant_id_identifier_system_identifier__key" ON "hermes_sim"."healthcare_services"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_id_key" ON "hermes_sim"."schedules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_tenant_id_identifier_system_identifier_value_key" ON "hermes_sim"."schedules"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE INDEX "slots_tenant_id_schedule_id_start_at_idx" ON "hermes_sim"."slots"("tenant_id", "schedule_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "slots_tenant_id_id_key" ON "hermes_sim"."slots"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "slots_tenant_id_identifier_system_identifier_value_key" ON "hermes_sim"."slots"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_id_key" ON "hermes_sim"."patients"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_identifier_system_identifier_value_key" ON "hermes_sim"."patients"("tenant_id", "identifier_system", "identifier_value");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_document_type_document_number_key" ON "hermes_sim"."patients"("tenant_id", "document_type", "document_number");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_patient_id_start_at_idx" ON "hermes_sim"."appointments"("tenant_id", "patient_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_identifier_system_identifier_value_key" ON "hermes_sim"."appointments"("tenant_id", "identifier_system", "identifier_value");

-- AddForeignKey
ALTER TABLE "hermes_sim"."schedules" ADD CONSTRAINT "schedules_tenant_id_practitioner_id_fkey" FOREIGN KEY ("tenant_id", "practitioner_id") REFERENCES "hermes_sim"."practitioners"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hermes_sim"."schedules" ADD CONSTRAINT "schedules_tenant_id_healthcare_service_id_fkey" FOREIGN KEY ("tenant_id", "healthcare_service_id") REFERENCES "hermes_sim"."healthcare_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hermes_sim"."slots" ADD CONSTRAINT "slots_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "hermes_sim"."schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hermes_sim"."appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "hermes_sim"."patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hermes_sim"."appointments" ADD CONSTRAINT "appointments_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "hermes_sim"."schedules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hermes_sim"."appointments" ADD CONSTRAINT "appointments_tenant_id_slot_id_fkey" FOREIGN KEY ("tenant_id", "slot_id") REFERENCES "hermes_sim"."slots"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa en el schema.
ALTER TABLE "hermes_sim"."slots"
  ADD CONSTRAINT "slots_time_range_check" CHECK ("end_at" > "start_at");

ALTER TABLE "hermes_sim"."appointments"
  ADD CONSTRAINT "appointments_time_range_check" CHECK ("end_at" > "start_at");
