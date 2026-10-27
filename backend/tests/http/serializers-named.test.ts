import { describe, expect, it } from "vitest";
import {
  healthcareServiceJson,
  practitionerJson,
  simPractitionerJson,
  simServiceJson,
} from "@/http/serializers";

const named = {
  id: "n-1",
  tenantId: "t1",
  identifier: { system: "urn:hermes:practitioner", value: "PR-1" },
  name: "Dra. Ana",
  active: true,
};

const simNamed = {
  id: "s-1",
  tenantId: "t1",
  identifierSystem: "urn:hermes:healthcare-service",
  identifierValue: "HS-1",
  name: "Consulta general",
  active: false,
};

describe("http: serializers de recursos nombrados", () => {
  it("serializa Practitioner y HealthcareService del dominio", () => {
    expect(practitionerJson(named)).toEqual({
      id: "n-1",
      identifier_system: "urn:hermes:practitioner",
      identifier_value: "PR-1",
      name: "Dra. Ana",
      active: true,
    });
    expect(healthcareServiceJson({ ...named, id: "hs-1" })).toEqual({
      id: "hs-1",
      identifier_system: "urn:hermes:practitioner",
      identifier_value: "PR-1",
      name: "Dra. Ana",
      active: true,
    });
  });

  it("serializa Practitioner y HealthcareService del simulador", () => {
    expect(simPractitionerJson(simNamed)).toEqual({
      id: "s-1",
      identifier_system: "urn:hermes:healthcare-service",
      identifier_value: "HS-1",
      name: "Consulta general",
      active: false,
    });
    expect(simServiceJson({ ...simNamed, id: "svc-1", active: true })).toEqual({
      id: "svc-1",
      identifier_system: "urn:hermes:healthcare-service",
      identifier_value: "HS-1",
      name: "Consulta general",
      active: true,
    });
  });
});
