import { describe, expect, it } from "vitest";
import { validatePreRegistration } from "@/modules/patients/domain/pre-registration";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const VALID = {
  documentType: "CC" as const,
  documentNumber: "1020304050",
  givenNames: "  Ana  María ",
  familyNames: "Pérez Gómez",
  birthDate: "1990-03-07",
  phone: "+57 300 123 4567",
  email: " Ana@Correo.COM ",
};
const TODAY = "2026-10-02";

function fieldOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof ValidationError ? (error.details as { field: string }).field : error;
  }
  return null;
}

describe("pre-registro: validacion autoritativa", () => {
  it("normaliza nombres, celular y correo", () => {
    expect(validatePreRegistration(VALID, TODAY)).toEqual({
      ...VALID,
      givenNames: "Ana María",
      phone: "3001234567",
      email: "ana@correo.com",
    });
  });

  it("rechaza cada campo invalido con su nombre", () => {
    expect(fieldOf(() => validatePreRegistration({ ...VALID, documentNumber: "12" }, TODAY))).toBe(
      "document_number",
    );
    expect(fieldOf(() => validatePreRegistration({ ...VALID, givenNames: "Ana3" }, TODAY))).toBe(
      "given_names",
    );
    expect(
      fieldOf(() => validatePreRegistration({ ...VALID, birthDate: "2027-01-01" }, TODAY)),
    ).toBe("birth_date");
    expect(
      fieldOf(() => validatePreRegistration({ ...VALID, birthDate: "1990-02-30" }, TODAY)),
    ).toBe("birth_date");
    expect(fieldOf(() => validatePreRegistration({ ...VALID, phone: "6011234567" }, TODAY))).toBe(
      "phone",
    );
    expect(fieldOf(() => validatePreRegistration({ ...VALID, email: "sin-arroba" }, TODAY))).toBe(
      "email",
    );
  });

  it("el correo es opcional", () => {
    expect(validatePreRegistration({ ...VALID, email: null }, TODAY).email).toBeNull();
  });
});
