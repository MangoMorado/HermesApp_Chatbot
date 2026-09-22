import { describe, expect, it } from "vitest";
import { toApiError } from "@/http/errors";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("dominio: errores de validacion en el contrato REST", () => {
  it("un ValidationError se traduce a validation_failed con sus detalles", () => {
    const error = toApiError(new ValidationError("limit fuera de rango", { field: "limit" }));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toBe("limit fuera de rango");
    expect(error.details).toEqual({ field: "limit" });
  });
});
