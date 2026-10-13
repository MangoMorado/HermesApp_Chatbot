import { CAPABILITY_DATE, FHIR_VERSION, SOFTWARE_NAME } from "./profiles";
import type { DeclaredResource } from "./registry";
import type { CapabilityStatement } from "./resources/types";

/** `metadata` se genera del registro: declara exactamente lo que se despacha. */
export function capabilityStatement(resources: readonly DeclaredResource[]): CapabilityStatement {
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: CAPABILITY_DATE,
    kind: "instance",
    software: { name: SOFTWARE_NAME },
    implementation: { description: `${SOFTWARE_NAME}: integracion FHIR con Hermes` },
    fhirVersion: FHIR_VERSION,
    format: ["json"],
    rest: [
      {
        mode: "server",
        security: { description: "Token portador (JWT) con rol service. Sin SMART." },
        resource: resources.map((resource) => ({
          type: resource.type,
          interaction: [{ code: "read" }, { code: "search-type" }],
          searchParam: resource.searchParams.map((param) => ({
            name: param.name,
            type: param.type,
          })),
        })),
      },
    ],
  };
}
