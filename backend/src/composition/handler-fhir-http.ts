import { GET, PUT } from "@/app/fhir/[[...path]]/route";
import type { FhirHttp } from "@/modules/hermes-simulator/domain/ports/fhir-http";

function segmentsOf(path: string): string[] {
  const url = new URL(`http://localhost/fhir/${path}`);
  return url.pathname
    .replace(/^\/fhir\/?/, "")
    .split("/")
    .filter(Boolean);
}

/**
 * Transporte de las pruebas: invoca los handlers de `/fhir` sin abrir un puerto.
 * El script y el proceso que sirve usan `fetch`.
 */
export function createHandlerFhirHttp(): FhirHttp {
  return {
    async request(input) {
      const url = new URL(`http://localhost/fhir/${input.path}`);
      const headers = new Headers({ Authorization: `Bearer ${input.token}` });
      if (input.body !== undefined) {
        headers.set("Content-Type", "application/fhir+json");
      }
      if (input.idempotencyKey) {
        headers.set("Idempotency-Key", input.idempotencyKey);
      }
      const request = new Request(url, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const context = { params: Promise.resolve({ path: segmentsOf(input.path) }) };
      const response =
        input.method === "GET" ? await GET(request, context) : await PUT(request, context);
      return { status: response.status, body: await response.json() };
    },
  };
}
