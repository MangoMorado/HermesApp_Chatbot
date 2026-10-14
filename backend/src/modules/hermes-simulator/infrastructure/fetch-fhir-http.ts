import type { FhirHttp } from "../domain/ports/fhir-http";

/** Cliente HTTP real. `baseUrl` es `FHIR_BASE_URL`, sin barra final. */
export function createFetchFhirHttp(baseUrl: string): FhirHttp {
  return {
    async request(input) {
      const headers = new Headers({
        Authorization: `Bearer ${input.token}`,
        Accept: "application/fhir+json",
      });
      if (input.body !== undefined) {
        headers.set("Content-Type", "application/fhir+json");
      }
      if (input.idempotencyKey) {
        headers.set("Idempotency-Key", input.idempotencyKey);
      }
      const response = await fetch(`${baseUrl}/${input.path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
