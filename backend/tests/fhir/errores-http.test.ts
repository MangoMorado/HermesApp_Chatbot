import { describe, expect, it } from "vitest";
import { fhirResponse, toFhirError } from "@/http/fhir-route";
import { operationOutcome } from "@/modules/fhir/domain/operation-outcome";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("fhir-conformance: tabla de errores", () => {
  it("un error generico es 500 exception sin filtrar su mensaje", async () => {
    const failure = toFhirError(new Error("secreto interno"));
    expect([failure.status, failure.code, failure.message]).toEqual([
      500,
      "exception",
      "Error interno",
    ]);

    const response = fhirResponse(
      operationOutcome(failure.code, failure.message),
      failure.status,
      "req-500",
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/fhir+json");
    expect(response.headers.get("X-Request-Id")).toBe("req-500");
    expect(await response.text()).not.toContain("secreto");
  });

  it("NotFoundError es 404 not-found y ValidationError es 400 invalid", () => {
    const missing = toFhirError(new NotFoundError("Patient"));
    expect([missing.status, missing.code]).toEqual([404, "not-found"]);
    const invalid = toFhirError(new ValidationError("x"));
    expect([invalid.status, invalid.code]).toEqual([400, "invalid"]);
  });
});
