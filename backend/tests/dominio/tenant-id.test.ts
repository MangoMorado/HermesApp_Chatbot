import { describe, expect, it } from "vitest";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("dominio: tenant id", () => {
  it("acepta un identificador no vacio", () => {
    expect(toTenantId("clinica-norte")).toBe("clinica-norte");
  });

  it.each(["", "   "])("rechaza %j", (raw) => {
    expect(() => toTenantId(raw)).toThrow(ValidationError);
  });
});
