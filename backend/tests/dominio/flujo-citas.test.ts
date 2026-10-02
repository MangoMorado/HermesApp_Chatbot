import { describe, expect, it } from "vitest";
import { formatLocalDay } from "@/modules/conversation/domain/format";
import type { AvailableSlot } from "@/modules/conversation/domain/reads";
import {
  appointmentsMenu,
  cancelConfirm,
  pickAppointment,
} from "@/modules/conversation/domain/steps/appointments";
import {
  bookConfirm,
  bookDay,
  bookPractitioner,
  bookSlot,
} from "@/modules/conversation/domain/steps/booking";
import { ctx, fakeReads, keysOf, makeEnv, NOW, okOutcome, opt, TZ } from "./flujo-support";

const HOUR = 3_600_000;
const slot = (id: string, hoursFromNow: number): AvailableSlot => ({
  id,
  startAt: new Date(NOW.getTime() + hoursFromNow * HOUR),
  serviceName: "Medicina general",
  practitionerName: "Dra. Ruiz",
});
// Lunes 08:00 Bogota: +1h y +2h el lunes, +25h el martes, +49h el miercoles.
const SLOTS = [slot("s1", 1), slot("s2", 2), slot("s3", 25), slot("s4", 49)];
const APPOINTMENT = {
  id: "ap1",
  startAt: new Date(NOW.getTime() + 72 * HOUR),
  serviceId: "svc1",
  serviceName: "Medicina general",
  practitionerName: "Dra. Ruiz",
};
const reads = fakeReads({
  listPractitioners: async () => [{ id: "p1", name: "Dra. Ruiz" }],
  listAvailableSlots: async (_t, f) => SLOTS.filter((s) => s.startAt >= f.from && s.startAt < f.to),
  listUpcomingAppointments: async () => [APPOINTMENT],
});
const env = makeEnv(reads);
const booking = { kind: "book" as const, serviceId: "svc1", practitionerId: null, dayOffset: 0 };

describe("flujo: citas", () => {
  it("el submenu exige paciente verificado", async () => {
    expect(await appointmentsMenu.enter(ctx(), env)).toMatchObject({
      kind: "goto",
      goto: "id_document_type",
    });
    const handled = await appointmentsMenu.handle(opt("appt:book"), ctx({ patientId: "mr" }), env);
    expect(handled).toMatchObject({ goto: "book_service", context: { booking: { kind: "book" } } });
  });

  it("profesional: lista y Cualquiera", async () => {
    const entered = await bookPractitioner.enter(
      ctx({ booking: { kind: "book", serviceId: "svc1" } }),
      env,
    );
    expect(entered.kind === "prompt" && entered.options.map((o) => o.value)).toEqual([
      "prac:p1",
      "prac:any",
    ]);
    const any = await bookPractitioner.handle(
      opt("prac:any"),
      ctx({ booking: { kind: "book", serviceId: "svc1" } }),
      env,
    );
    expect(any.context.booking).toMatchObject({ practitionerId: null, dayOffset: 0 });
  });

  it("dias con cupo, en orden y con su etiqueta local", async () => {
    const entered = await bookDay.enter(ctx({ booking }), env);
    expect(entered.kind === "prompt" && entered.options.map((o) => o.value)).toEqual([
      "day:2026-10-05",
      "day:2026-10-06",
      "day:2026-10-07",
    ]);
    expect(entered.kind === "prompt" && entered.options[0]?.label).toEqual({
      literal: formatLocalDay("2026-10-05", TZ),
    });
  });

  it("sin cupos vuelve al submenu con aviso", async () => {
    const empty = makeEnv(fakeReads());
    const entered = await bookDay.enter(ctx({ booking }), empty);
    expect(entered).toMatchObject({ kind: "goto", goto: "appointments_menu" });
    expect(keysOf(entered.lines)).toEqual(["book_no_days"]);
  });

  it("horas del dia elegido y confirmacion con datos de dominio", async () => {
    const withDay = ctx({
      patientId: "mr",
      booking: { ...booking, day: "2026-10-05", slotOffset: 0 },
    });
    const hours = await bookSlot.enter(withDay, env);
    expect(hours.kind === "prompt" && hours.options.map((o) => o.value)).toEqual([
      "slot:s1",
      "slot:s2",
    ]);
    const chosen = await bookSlot.handle(opt("slot:s2"), withDay, env);
    const confirm = await bookConfirm.enter(chosen.context, env);
    expect(confirm.kind === "prompt" && confirm.lines[0]?.text).toMatchObject({
      key: "book_confirm_prompt",
      params: { service: "Medicina general", practitioner: "Dra. Ruiz" },
    });
    const handled = await bookConfirm.handle(opt("book:confirm"), chosen.context, env);
    expect(handled.effect).toEqual({
      kind: "request_appointment",
      medicalRecordId: "mr",
      command: { kind: "book", slotId: "s2" },
    });
    const created = handled.onOutcome?.(
      okOutcome({ expiresAt: new Date(NOW.getTime() + 4 * HOUR) }),
    );
    expect(created?.goto).toBe("appointments_menu");
    expect(keysOf(created?.lines ?? [])).toEqual(["request_created"]);
    const taken = handled.onOutcome?.({ ok: false, failure: "slot_unavailable" });
    expect(taken?.goto).toBe("book_slot");
    expect(taken?.context.booking?.slotId).toBeUndefined();
    const capped = handled.onOutcome?.({ ok: false, failure: "pending_limit_reached", max: 2 });
    expect(capped?.lines[0]).toEqual({ text: { key: "pending_limit", params: { max: "2" } } });
  });

  it("reprogramar parte de la cita elegida con su servicio", async () => {
    const context = ctx({ patientId: "mr", booking: { kind: "reschedule" } });
    const handled = await pickAppointment.handle(opt("pick:ap1"), context, env);
    expect(handled).toMatchObject({
      goto: "book_day",
      context: {
        booking: {
          kind: "reschedule",
          appointmentId: "ap1",
          serviceId: "svc1",
          practitionerId: null,
        },
      },
    });
  });

  it("cancelar declara la solicitud de cancelacion", async () => {
    const context = ctx({ patientId: "mr", booking: { kind: "cancel", appointmentId: "ap1" } });
    const entered = await cancelConfirm.enter(context, env);
    expect(entered.kind === "prompt" && entered.lines[0]?.text).toMatchObject({
      key: "cancel_confirm_prompt",
    });
    const handled = await cancelConfirm.handle(opt("cancel:confirm"), context, env);
    expect(handled.effect).toEqual({
      kind: "request_appointment",
      medicalRecordId: "mr",
      command: { kind: "cancel", appointmentId: "ap1" },
    });
    const pending = handled.onOutcome?.({ ok: false, failure: "appointment_change_pending" });
    expect(keysOf(pending?.lines ?? [])).toEqual(["change_pending"]);
  });
});
