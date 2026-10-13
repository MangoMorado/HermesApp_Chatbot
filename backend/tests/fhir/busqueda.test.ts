import { describe, expect, it } from "vitest";
import { FhirError } from "@/modules/fhir/domain/fhir-error";
import { operationOutcome } from "@/modules/fhir/domain/operation-outcome";
import {
  assertSupported,
  collectParams,
  parseBoolean,
  parseCode,
  parseDateBounds,
  parseReference,
  parseToken,
  parseWindow,
  single,
} from "@/modules/fhir/domain/search";

const ZONE = "America/Bogota";

function params(query: string) {
  return collectParams(new URLSearchParams(query).entries());
}

function failure(run: () => unknown): { status: number; code: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof FhirError) {
      return { status: error.status, code: error.code };
    }
    throw error;
  }
  throw new Error("deberia haber fallado");
}

const INVALID = { status: 400, code: "invalid" };

describe("fhir-conformance: OperationOutcome", () => {
  it("lleva un issue de severidad error", () => {
    expect(operationOutcome("not-found", "Recurso inexistente")).toEqual({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "not-found", diagnostics: "Recurso inexistente" }],
    });
  });
});

describe("fhir-conformance: parametros soportados", () => {
  it("admite los declarados y los de control", () => {
    expect(() =>
      assertSupported(params("active=true&_count=5&_offset=0"), ["active"]),
    ).not.toThrow();
  });

  it("rechaza uno no declarado con not-supported", () => {
    expect(failure(() => assertSupported(params("name=ana"), ["active"]))).toEqual({
      status: 400,
      code: "not-supported",
    });
  });

  it("un modificador es un parametro no soportado", () => {
    expect(failure(() => assertSupported(params("active:not=true"), ["active"])).code).toBe(
      "not-supported",
    );
  });
});

describe("fhir-conformance: valores unicos", () => {
  it("devuelve null si el parametro no viene", () => {
    expect(single(params(""), "status")).toBeNull();
  });

  it("repetido o vacio es invalid", () => {
    expect(failure(() => single(params("status=free&status=busy"), "status"))).toEqual(INVALID);
    expect(failure(() => single(params("identifier="), "identifier"))).toEqual(INVALID);
  });
});

describe("fhir-conformance: token, referencia, booleano y codigo", () => {
  it("token exige system y value", () => {
    expect(parseToken("identifier", "urn:hermes:patient|MR-1")).toEqual({
      system: "urn:hermes:patient",
      value: "MR-1",
    });
    expect(parseToken("identifier", "urn:x|a|b").value).toBe("a|b");
    for (const raw of ["MR-1", "|MR-1", "urn:x|"]) {
      expect(failure(() => parseToken("identifier", raw))).toEqual(INVALID);
    }
  });

  it("referencia exige un tipo admitido y un id", () => {
    expect(parseReference("schedule", "Schedule/s-1", ["Schedule"])).toEqual({
      type: "Schedule",
      id: "s-1",
    });
    for (const raw of ["s-1", "Slot/s-1", "Schedule/", "Schedule/a/b"]) {
      expect(failure(() => parseReference("schedule", raw, ["Schedule"]))).toEqual(INVALID);
    }
  });

  it("booleano y codigo validan su valor", () => {
    expect(parseBoolean("active", "false")).toBe(false);
    expect(failure(() => parseBoolean("active", "si"))).toEqual(INVALID);
    expect(parseCode("status", "booked", ["booked", "cancelled"])).toBe("booked");
    expect(failure(() => parseCode("status", "free,busy", ["free", "busy"]))).toEqual(INVALID);
  });
});

describe("fhir-conformance: _count y _offset", () => {
  it("aplica los predeterminados", () => {
    expect(parseWindow(params(""))).toEqual({ offset: 0, limit: 50 });
  });

  it("recorta _count al maximo, tambien un valor desmedido", () => {
    expect(parseWindow(params("_count=500")).limit).toBe(200);
    expect(parseWindow(params("_count=99999999999999999999")).limit).toBe(200);
  });

  it("rechaza _count no entero o menor que 1", () => {
    for (const raw of ["0", "-1", "1.5", "abc"]) {
      expect(failure(() => parseWindow(params(`_count=${raw}`)))).toEqual(INVALID);
    }
  });

  it("rechaza _offset negativo, no entero o desmedido", () => {
    for (const raw of ["-1", "2.5", "abc", "99999999999999999999", "2147483648"]) {
      expect(failure(() => parseWindow(params(`_offset=${raw}`)))).toEqual(INVALID);
    }
    expect(parseWindow(params("_offset=2147483647")).offset).toBe(2147483647);
  });
});

describe("fhir-conformance: fechas", () => {
  const day = new Date("2026-06-15T05:00:00.000Z");
  const nextDay = new Date("2026-06-16T05:00:00.000Z");

  it("una fecha sin hora es el dia en la zona de la aplicacion", () => {
    expect(parseDateBounds("start", ["2026-06-15"], ZONE)).toEqual([
      { op: "ge", at: day },
      { op: "lt", at: nextDay },
    ]);
    expect(parseDateBounds("start", ["eq2026-06-15"], ZONE)).toHaveLength(2);
    expect(parseDateBounds("start", ["ge2026-06-15"], ZONE)).toEqual([{ op: "ge", at: day }]);
    expect(parseDateBounds("start", ["gt2026-06-15"], ZONE)).toEqual([{ op: "ge", at: nextDay }]);
    expect(parseDateBounds("start", ["le2026-06-15"], ZONE)).toEqual([{ op: "lt", at: nextDay }]);
    expect(parseDateBounds("start", ["lt2026-06-15"], ZONE)).toEqual([{ op: "lt", at: day }]);
  });

  it("un instante con offset se usa tal cual", () => {
    const at = new Date("2026-06-15T14:00:00.000Z");
    expect(parseDateBounds("start", ["ge2026-06-15T09:00:00-05:00"], ZONE)).toEqual([
      { op: "ge", at },
    ]);
    expect(parseDateBounds("start", ["2026-06-15T14:00:00Z"], ZONE)).toEqual([
      { op: "ge", at },
      { op: "le", at },
    ]);
  });

  it("varias cotas forman un rango", () => {
    expect(parseDateBounds("start", ["ge2026-06-15", "lt2026-06-16"], ZONE)).toEqual([
      { op: "ge", at: day },
      { op: "lt", at: nextDay },
    ]);
  });

  it("acepta el + del offset aunque llegue como espacio", () => {
    const decoded = new URLSearchParams("start=ge2026-06-15T14:00:00+00:00").getAll("start");
    expect(decoded).toEqual(["ge2026-06-15T14:00:00 00:00"]);
    expect(parseDateBounds("start", decoded, ZONE)).toEqual([
      { op: "ge", at: new Date("2026-06-15T14:00:00.000Z") },
    ]);
  });

  it("rechaza fechas imposibles, sin offset o mal formadas", () => {
    for (const raw of [
      "2026-02-31",
      "2026-06-15T09:00:00",
      "ayer",
      "ge",
      "xx2026-06-15",
      "",
      "2026-02-31T10:00:00Z",
      "ge2026-04-31T10:00:00-05:00",
      "2026-06-15T24:00:00Z",
      "2026-06-15T23:60:00Z",
    ]) {
      expect(failure(() => parseDateBounds("start", [raw], ZONE))).toEqual(INVALID);
    }
  });
});
