-- CreateEnum
CREATE TYPE "appointment_request_kind" AS ENUM ('book', 'reschedule', 'cancel');

-- CreateEnum
CREATE TYPE "appointment_request_status" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "resolution_reason" AS ENUM ('slot_unavailable', 'declined');

-- CreateTable
CREATE TABLE "appointment_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" "appointment_request_kind" NOT NULL,
    "status" "appointment_request_status" NOT NULL DEFAULT 'pending',
    "medical_record_id" TEXT NOT NULL,
    "slot_id" TEXT,
    "appointment_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "resolution_reason" "resolution_reason",
    "resulting_appointment_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "appointment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_requests_tenant_id_status_expires_at_idx" ON "appointment_requests"("tenant_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "appointment_requests_tenant_id_medical_record_id_status_idx" ON "appointment_requests"("tenant_id", "medical_record_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_requests_tenant_id_id_key" ON "appointment_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_tenant_id_medical_record_id_fkey" FOREIGN KEY ("tenant_id", "medical_record_id") REFERENCES "medical_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_tenant_id_slot_id_fkey" FOREIGN KEY ("tenant_id", "slot_id") REFERENCES "slots"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_tenant_id_resulting_appointment_id_fkey" FOREIGN KEY ("tenant_id", "resulting_appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Forma de cada tipo de solicitud.
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_kind_shape_check" CHECK (
  ("kind" = 'book' AND "slot_id" IS NOT NULL AND "appointment_id" IS NULL)
  OR ("kind" = 'reschedule' AND "slot_id" IS NOT NULL AND "appointment_id" IS NOT NULL)
  OR ("kind" = 'cancel' AND "slot_id" IS NULL AND "appointment_id" IS NOT NULL)
);
-- El motivo acompana solo al rechazo.
ALTER TABLE "appointment_requests" ADD CONSTRAINT "appointment_requests_reason_check"
  CHECK (("resolution_reason" IS NOT NULL) = ("status" = 'rejected'));
-- Una sola solicitud viva por cupo y por cita: dos solicitudes concurrentes no pueden quedar pendientes sobre lo mismo.
CREATE UNIQUE INDEX "appointment_requests_one_pending_per_slot"
  ON "appointment_requests"("tenant_id", "slot_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "appointment_requests_one_pending_per_appointment"
  ON "appointment_requests"("tenant_id", "appointment_id") WHERE "status" = 'pending';
