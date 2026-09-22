import { describe, expect, it } from "vitest";
import { buildSeed } from "../../prisma/seed/data";
import { todayIn, zonedInstant } from "../../prisma/seed/time";

const ANCHOR = "2026-03-02"; // lunes
const ZONE = "America/Bogota";

describe("dominio: datos del seed", () => {
  it("una hora local de Bogota se guarda en UTC-5", () => {
    expect(zonedInstant("2026-03-02", "08:00", ZONE).toISOString()).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("todayIn devuelve la fecha local", () => {
    expect(todayIn(ZONE, new Date("2026-03-03T03:00:00Z"))).toBe("2026-03-02");
  });

  it("mismo ancla produce exactamente los mismos datos", () => {
    expect(buildSeed(ANCHOR, ZONE)).toEqual(buildSeed(ANCHOR, ZONE));
  });

  it("deja dos tenants con la forma pedida por la spec", () => {
    const tenants = buildSeed(ANCHOR, ZONE);
    expect(tenants.map((tenant) => tenant.slug)).toEqual(["clinica-norte", "clinica-sur"]);
    for (const tenant of tenants) {
      expect(tenant.practitioners).toHaveLength(3);
      expect(tenant.services).toHaveLength(2);
      expect(tenant.schedules).toHaveLength(3);
      expect(tenant.patients).toHaveLength(5);
      expect(tenant.patients.filter((p) => p.status === "pre_registered")).toHaveLength(1);
      expect(tenant.appointments.filter((a) => a.status === "fulfilled")).toHaveLength(4);
      expect(tenant.appointments.filter((a) => a.status === "booked")).toHaveLength(4);
    }
  });

  it("los cupos caen en dias habiles y solo los de una cita estan ocupados", () => {
    for (const tenant of buildSeed(ANCHOR, ZONE)) {
      const busy = new Set(tenant.appointments.map((a) => a.slotId));
      for (const slot of tenant.slots) {
        const localDay = new Date(slot.startAt.getTime() - 5 * 3600_000).getUTCDay();
        expect([0, 6]).not.toContain(localDay);
        expect(slot.status).toBe(busy.has(slot.id) ? "busy" : "free");
      }
    }
  });

  it("las citas pasadas estan antes del ancla y las futuras despues", () => {
    const anchorInstant = zonedInstant(ANCHOR, "00:00", ZONE).getTime();
    for (const tenant of buildSeed(ANCHOR, ZONE)) {
      for (const appointment of tenant.appointments) {
        const before = appointment.startAt.getTime() < anchorInstant;
        expect(before).toBe(appointment.status === "fulfilled");
      }
    }
  });

  it("los ids son distintos entre tenants", () => {
    const [norte, sur] = buildSeed(ANCHOR, ZONE);
    const idsNorte = new Set(norte?.practitioners.map((p) => p.id));
    expect(sur?.practitioners.some((p) => idsNorte.has(p.id))).toBe(false);
  });
});
