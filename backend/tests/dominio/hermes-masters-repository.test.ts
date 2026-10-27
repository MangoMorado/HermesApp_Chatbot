import { describe, expect, it, vi } from "vitest";
import type { HealthcareService, Practitioner } from "@/modules/scheduling/domain/entities";
import { createPrismaHermesMasterStore } from "@/modules/scheduling/infrastructure/prisma-hermes-masters";

const practitioner: Practitioner = {
  id: "pr-1",
  tenantId: "t1",
  identifier: { system: "urn:hermes:practitioner", value: "PR-1" },
  name: "Dra. Ana",
  active: true,
};

const service: HealthcareService = {
  id: "hs-1",
  tenantId: "t1",
  identifier: { system: "urn:hermes:healthcare-service", value: "HS-1" },
  name: "Consulta",
  active: true,
};

describe("dominio: store Prisma de maestros Hermes", () => {
  it("persiste practitioner y service en modo insert usando el mapper nombrado", async () => {
    const practitionerCreate = vi.fn(async () => ({}));
    const serviceCreate = vi.fn(async () => ({}));
    const store = createPrismaHermesMasterStore({
      practitioner: { create: practitionerCreate },
      healthcareService: { create: serviceCreate },
    } as never);

    await store.savePractitioner(practitioner, "insert");
    await store.saveHealthcareService(service, "insert");

    expect(practitionerCreate).toHaveBeenCalledWith({
      data: {
        id: "pr-1",
        tenantId: "t1",
        identifierSystem: "urn:hermes:practitioner",
        identifierValue: "PR-1",
        name: "Dra. Ana",
        active: true,
      },
    });
    expect(serviceCreate).toHaveBeenCalledWith({
      data: {
        id: "hs-1",
        tenantId: "t1",
        identifierSystem: "urn:hermes:healthcare-service",
        identifierValue: "HS-1",
        name: "Consulta",
        active: true,
      },
    });
  });
});
