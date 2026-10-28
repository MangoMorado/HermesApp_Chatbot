import { describe, expect, it } from "vitest";
import {
  isEmailShape,
  parseEmailAddress,
  parseMobilePhone,
  parsePastDate,
  parsePersonName,
} from "@/modules/shared/domain/pre-registration-parsers";

describe("parsers de pre-registro compartidos", () => {
  it("isEmailShape exige un solo @ y dominio con punto", () => {
    expect(isEmailShape("ana@correo.com")).toBe(true);
    expect(isEmailShape("ana@@correo.com")).toBe(false);
    expect(isEmailShape("@correo.com")).toBe(false);
    expect(isEmailShape("ana@correo")).toBe(false);
    expect(isEmailShape("ana correo@x.com")).toBe(false);
  });

  it("parseEmailAddress normaliza y acota longitud", () => {
    expect(parseEmailAddress(" Ana@Correo.COM ")).toBe("ana@correo.com");
    expect(parseEmailAddress("no-es-correo")).toBeNull();
  });

  it("parsePersonName y parseMobilePhone validan forma", () => {
    expect(parsePersonName("  Ana  María ")).toBe("Ana María");
    expect(parsePersonName("Ana3")).toBeNull();
    expect(parseMobilePhone("+57 300 123 4567")).toBe("3001234567");
    expect(parseMobilePhone("1991234567")).toBeNull();
  });

  it("parsePastDate exige fecha real no futura", () => {
    expect(parsePastDate("1990-03-07", "2026-10-02")).toBe("1990-03-07");
    expect(parsePastDate("2026-10-03", "2026-10-02")).toBeNull();
    expect(parsePastDate("1990-02-30", "2026-10-02")).toBeNull();
  });
});
