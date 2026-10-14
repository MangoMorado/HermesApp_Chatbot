import { describe, expect, it } from "vitest";
import { createFindMedicalRecord } from "@/modules/patients/application/find-medical-record";
import { createGetMedicalRecord } from "@/modules/patients/application/get-medical-record";
import { createListMedicalRecordAppointments } from "@/modules/patients/application/list-medical-record-appointments";
import type { HistoryAppointment, MedicalRecord } from "@/modules/patients/domain/entities";
import type {
  AppointmentHistory,
  MedicalRecordRepository,
} from "@/modules/patients/domain/ports/repositories";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toPage } from "@/modules/shared/domain/pagination";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const tenant = toTenantId("tenant-a");

const record: MedicalRecord = {
  id: "mr-1",
  tenantId: tenant,
  identifier: { system: "s", value: "1" },
  documentType: "CC",
  documentNumber: "123",
  givenNames: "Ana",
  familyNames: "Perez",
  birthDate: "1990-01-01",
  phone: null,
  email: null,
  status: "active",
};

function fakeRecords(rows: MedicalRecord[]): MedicalRecordRepository {
  return {
    async insertPreRegistered() {
      throw new Error("no usado en estas pruebas");
    },
    async insertActive() {
      throw new Error("no usado en estas pruebas");
    },
    async updateFromHermes() {
      throw new Error("no usado en estas pruebas");
    },
    async findByIdentifier() {
      throw new Error("no usado en estas pruebas");
    },
    async findByDocument(tenantId, documentType, documentNumber) {
      return (
        rows.find(
          (row) =>
            row.tenantId === tenantId &&
            row.documentType === documentType &&
            row.documentNumber === documentNumber,
        ) ?? null
      );
    },
    async get(tenantId, id) {
      return rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
    },
  };
}

describe("dominio: expedientes", () => {
  it("findMedicalRecord exige tipo y numero de documento", async () => {
    const find = createFindMedicalRecord(fakeRecords([record]));
    await expect(
      find({ tenantId: tenant, documentTypeRaw: null, documentNumberRaw: "123" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      find({ tenantId: tenant, documentTypeRaw: "CC", documentNumberRaw: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("findMedicalRecord encuentra por documento exacto", async () => {
    const found = await createFindMedicalRecord(fakeRecords([record]))({
      tenantId: tenant,
      documentTypeRaw: "CC",
      documentNumberRaw: "123",
    });
    expect(found.id).toBe("mr-1");
  });

  it("getMedicalRecord responde not_found si no existe en el tenant", async () => {
    await expect(
      createGetMedicalRecord(fakeRecords([record]))(tenant, "ajeno"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listMedicalRecordAppointments exige expediente propio y ordena historial", async () => {
    const historyRows: HistoryAppointment[] = [
      {
        id: "a1",
        tenantId: tenant,
        scheduleId: "sch",
        slotId: "sl",
        startAt: new Date("2026-01-02T10:00:00Z"),
        endAt: new Date("2026-01-02T10:30:00Z"),
        status: "fulfilled",
      },
    ];
    const history: AppointmentHistory = {
      async list(filter) {
        const data = historyRows.filter(
          (row) => row.tenantId === filter.tenantId && filter.medicalRecordId === "mr-1",
        );
        return toPage(data, filter.limit, (row) => ({
          key: row.startAt.toISOString(),
          id: row.id,
        }));
      },
    };
    const list = createListMedicalRecordAppointments(fakeRecords([record]), history);
    await expect(list({ tenantId: tenant, medicalRecordId: "ajeno" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const page = await list({ tenantId: tenant, medicalRecordId: "mr-1" });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.id).toBe("a1");
  });
});
