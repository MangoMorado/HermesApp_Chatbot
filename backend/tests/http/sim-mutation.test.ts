import { describe, expect, it, vi } from "vitest";
import {
  assertSimDelete,
  booleanOr,
  recordSimAudit,
  requireObjectBody,
  stringOr,
} from "@/http/sim-mutation";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("http: helpers de mutacion del simulador", () => {
  it("exige un cuerpo objeto", () => {
    expect(requireObjectBody({ a: 1 })).toEqual({ a: 1 });
    expect(() => requireObjectBody(null)).toThrow(ValidationError);
    expect(() => requireObjectBody("x")).toThrow(ValidationError);
  });

  it("elige string o fallback", () => {
    expect(stringOr("hola", "fallback")).toBe("hola");
    expect(stringOr(3, "fallback")).toBe("fallback");
  });

  it("elige boolean o fallback", () => {
    expect(booleanOr(true, false)).toBe(true);
    expect(booleanOr("si", false)).toBe(false);
  });

  it("registra auditoria con el actor y el reloj", async () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const auditLog = { record: vi.fn(async () => {}) };
    await recordSimAudit(
      { auditLog, clock: { now: () => now } },
      { tenantId: "t1" as never, subject: "admin-1", role: "admin" },
      "req-1",
      "sim.patient.updated",
      "sim.patient",
      "p-1",
    );
    expect(auditLog.record).toHaveBeenCalledWith({
      tenantId: "t1",
      actorSubject: "admin-1",
      actorRole: "admin",
      action: "sim.patient.updated",
      resourceType: "sim.patient",
      resourceId: "p-1",
      requestId: "req-1",
      occurredAt: now,
    });
  });

  it("traduce el resultado del delete a errores HTTP", () => {
    expect(() => assertSimDelete("ok", "conflicto")).not.toThrow();
    expect(() => assertSimDelete("missing", "conflicto")).toThrow(NotFoundError);
    expect(() => assertSimDelete("has_dependents", "tiene dependientes")).toThrow(ConflictError);
  });
});
