import { describe, expect, it, vi } from "vitest";
import { createUpsertHealthcareServiceFromHermes } from "@/modules/scheduling/application/upsert-healthcare-service-from-hermes";
import { createUpsertPractitionerFromHermes } from "@/modules/scheduling/application/upsert-practitioner-from-hermes";
import { createUpsertScheduleFromHermes } from "@/modules/scheduling/application/upsert-schedule-from-hermes";
import type {
  HealthcareService,
  Practitioner,
  Schedule,
} from "@/modules/scheduling/domain/entities";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

function dependencies() {
  const store = {
    findPractitionerByIdentifier: vi.fn(async () => null as Practitioner | null),
    savePractitioner: vi.fn(async () => {}),
    findHealthcareServiceByIdentifier: vi.fn(async () => null as HealthcareService | null),
    saveHealthcareService: vi.fn(async () => {}),
    findScheduleByIdentifier: vi.fn(async () => null as Schedule | null),
    getPractitioner: vi.fn(async () => null as Practitioner | null),
    getHealthcareService: vi.fn(async () => null as HealthcareService | null),
    saveSchedule: vi.fn(async () => {}),
  };
  return {
    store,
    audit: { record: vi.fn(async () => {}) },
    ids: { next: () => "new-id" },
    clock: { now: () => new Date("2026-10-14T12:00:00.000Z") },
  };
}

const actor = { actorSubject: "hermes", actorRole: "service", requestId: "r1" };

describe("dominio: upsert de maestros desde Hermes", () => {
  it("crea y audita un Practitioner cuando el identificador no existe", async () => {
    const deps = dependencies();
    const result = await createUpsertPractitionerFromHermes(deps)({
      tenantId: "t1" as never,
      actor,
      identifier: { system: "urn:hermes:practitioner", value: "P-1" },
      name: "Dra. Ana Perez",
      active: true,
    });

    expect(result).toEqual({
      outcome: "created",
      record: {
        id: "new-id",
        tenantId: "t1",
        identifier: { system: "urn:hermes:practitioner", value: "P-1" },
        name: "Dra. Ana Perez",
        active: true,
      },
    });
    expect(deps.store.savePractitioner).toHaveBeenCalledWith(result.record, "insert");
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "practitioner.written_by_hermes",
        resourceType: "practitioner",
        resourceId: "new-id",
      }),
    );
  });

  it("actualiza un Practitioner conservando su id", async () => {
    const deps = dependencies();
    deps.store.findPractitionerByIdentifier.mockResolvedValue({
      id: "practitioner-1",
      tenantId: "t1",
      identifier: { system: "urn:hermes:practitioner", value: "P-1" },
      name: "Nombre anterior",
      active: true,
    });

    const result = await createUpsertPractitionerFromHermes(deps)({
      tenantId: "t1" as never,
      actor,
      identifier: { system: "urn:hermes:practitioner", value: "P-1" },
      name: "Dra. Ana Perez",
      active: false,
    });

    expect(result.outcome).toBe("updated");
    expect(result.record.id).toBe("practitioner-1");
    expect(deps.store.savePractitioner).toHaveBeenCalledWith(result.record, "update");
  });

  it("propaga ConflictError cuando savePractitioner falla por identificador duplicado", async () => {
    const deps = dependencies();
    deps.store.savePractitioner.mockRejectedValue(new ConflictError("El identificador ya existe"));

    await expect(
      createUpsertPractitionerFromHermes(deps)({
        tenantId: "t1" as never,
        actor,
        identifier: { system: "urn:hermes:practitioner", value: "P-1" },
        name: "Dra. Ana Perez",
        active: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it("crea y audita un HealthcareService", async () => {
    const deps = dependencies();
    const result = await createUpsertHealthcareServiceFromHermes(deps)({
      tenantId: "t1" as never,
      actor,
      identifier: { system: "urn:hermes:healthcare-service", value: "HS-1" },
      name: "Cardiologia",
      active: true,
    });

    expect(result.outcome).toBe("created");
    expect(deps.store.saveHealthcareService).toHaveBeenCalledWith(result.record, "insert");
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "healthcare_service.written_by_hermes",
        resourceType: "healthcare_service",
      }),
    );
  });

  it("crea y audita un Schedule cuando sus actores existen en el tenant", async () => {
    const deps = dependencies();
    deps.store.getPractitioner.mockResolvedValue({
      id: "practitioner-1",
      tenantId: "t1",
      identifier: { system: "urn:hermes:practitioner", value: "P-1" },
      name: "Dra. Ana Perez",
      active: true,
    });
    deps.store.getHealthcareService.mockResolvedValue({
      id: "service-1",
      tenantId: "t1",
      identifier: { system: "urn:hermes:healthcare-service", value: "HS-1" },
      name: "Cardiologia",
      active: true,
    });

    const result = await createUpsertScheduleFromHermes(deps)({
      tenantId: "t1" as never,
      actor,
      identifier: { system: "urn:hermes:schedule", value: "S-1" },
      practitionerId: "practitioner-1",
      healthcareServiceId: "service-1",
      active: true,
    });

    expect(result.outcome).toBe("created");
    expect(deps.store.saveSchedule).toHaveBeenCalledWith(result.record, "insert");
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "schedule.written_by_hermes",
        resourceType: "schedule",
      }),
    );
  });

  it("rechaza un Schedule si no existe el Practitioner del tenant", async () => {
    const deps = dependencies();

    const attempt = createUpsertScheduleFromHermes(deps)({
      tenantId: "t1" as never,
      actor,
      identifier: { system: "urn:hermes:schedule", value: "S-1" },
      practitionerId: "missing",
      healthcareServiceId: "service-1",
      active: true,
    });

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    expect(deps.store.saveSchedule).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it("rechaza un Schedule si no existe el HealthcareService del tenant", async () => {
    const deps = dependencies();
    deps.store.getPractitioner.mockResolvedValue({
      id: "practitioner-1",
      tenantId: "t1",
      identifier: { system: "urn:hermes:practitioner", value: "P-1" },
      name: "Dra. Ana Perez",
      active: true,
    });

    const attempt = createUpsertScheduleFromHermes(deps)({
      tenantId: "t1" as never,
      actor,
      identifier: { system: "urn:hermes:schedule", value: "S-1" },
      practitionerId: "practitioner-1",
      healthcareServiceId: "missing",
      active: true,
    });

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    expect(deps.store.saveSchedule).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });
});
