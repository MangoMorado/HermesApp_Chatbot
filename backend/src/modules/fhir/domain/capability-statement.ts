import {
  CAPABILITY_DATE,
  CONDITIONAL_ONLY,
  FHIR_VERSION,
  IDEMPOTENCY_DOCUMENTATION,
  SOFTWARE_NAME,
} from "./profiles";
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
        documentation: IDEMPOTENCY_DOCUMENTATION,
        security: { description: "Token portador (JWT) con rol service. Sin SMART." },
        resource: resources.map((resource) => ({
          type: resource.type,
          versioning: "no-version",
          readHistory: false,
          interaction: [
            { code: "read" },
            { code: "search-type" },
            ...(resource.writable
              ? [{ code: "update" as const, documentation: CONDITIONAL_ONLY }]
              : []),
          ],
          ...(resource.writable ? { conditionalUpdate: true, updateCreate: false } : {}),
          searchParam: resource.searchParams.map((param) => ({
            name: param.name,
            type: param.type,
          })),
        })),
      },
    ],
  };
}
