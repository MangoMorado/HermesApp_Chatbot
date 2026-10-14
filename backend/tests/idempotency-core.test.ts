import { describe, expect, it } from "vitest";
import { readIdempotentRequest } from "@/http/idempotency-core";

function request(query: string): Request {
  return new Request(`http://localhost/fhir/Patient?identifier=${query}`, {
    method: "PUT",
    headers: { "Idempotency-Key": "same-key" },
    body: JSON.stringify({ resourceType: "Patient" }),
  });
}

describe("idempotencia HTTP", () => {
  it("incluye la query en path y hash cuando se solicita pathname+search", async () => {
    const first = await readIdempotentRequest(
      request("urn:test|one"),
      "hermes",
      1,
      undefined,
      "pathname+search",
    );
    const second = await readIdempotentRequest(
      request("urn:test|two"),
      "hermes",
      1,
      undefined,
      "pathname+search",
    );

    expect(first.path).toBe("/fhir/Patient?identifier=urn:test|one");
    expect(second.path).toBe("/fhir/Patient?identifier=urn:test|two");
    expect(first.hash).not.toBe(second.hash);
  });

  it("mantiene pathname como valor predeterminado para REST", async () => {
    const result = await readIdempotentRequest(request("urn:test|one"), "operator");

    expect(result.path).toBe("/fhir/Patient");
  });
});
