import { describe, expect, it, vi } from "vitest";
import {
  createPrismaSimHealthcareServiceStore,
  createPrismaSimPractitionerStore,
} from "@/modules/hermes-simulator/infrastructure/prisma-stores";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const tenantId = toTenantId("t1");

const namedRow = {
  id: "n-1",
  tenantId: "t1",
  identifierSystem: "urn:hermes:practitioner",
  identifierValue: "PR-1",
  name: "Dra. Ana",
  active: true,
};

describe("dominio: mappers de stores del simulador", () => {
  it("mapea practitioner y service al leer por id", async () => {
    const practitioners = createPrismaSimPractitionerStore({
      simPractitioner: {
        findFirst: vi.fn(async () => namedRow),
      },
    } as never);
    const services = createPrismaSimHealthcareServiceStore({
      simHealthcareService: {
        findFirst: vi.fn(async () => ({
          ...namedRow,
          identifierSystem: "urn:hermes:healthcare-service",
          identifierValue: "HS-1",
          name: "Consulta",
        })),
      },
    } as never);

    await expect(practitioners.get(tenantId, "n-1")).resolves.toEqual({
      id: "n-1",
      tenantId: "t1",
      identifierSystem: "urn:hermes:practitioner",
      identifierValue: "PR-1",
      name: "Dra. Ana",
      active: true,
    });
    await expect(services.get(tenantId, "n-1")).resolves.toEqual({
      id: "n-1",
      tenantId: "t1",
      identifierSystem: "urn:hermes:healthcare-service",
      identifierValue: "HS-1",
      name: "Consulta",
      active: true,
    });
  });
});
