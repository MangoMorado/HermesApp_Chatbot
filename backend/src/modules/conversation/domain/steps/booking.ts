import { dayBounds, formatLocalDay, formatTime, formatWhen, localDate } from "../format";
import type { AvailableSlot } from "../reads";
import { choice, go, isOption, optionValue, prompt, redirect, retry } from "../step-kit";
import { line, literal, t } from "../text";
import type {
  AppointmentCommand,
  BookingDraft,
  ConversationContext,
  EffectOutcome,
  HandleResult,
  Step,
  StepEnv,
} from "../types";
import { failureLines } from "./appointments";

const DAYS_PER_PAGE = 5;
const SLOTS_PER_PAGE = 6;
const HORIZON_DAYS = 30;
const SLOT_LIMIT = 200;
const DAY_MS = 86_400_000;

function slotsBetween(
  booking: BookingDraft,
  env: StepEnv,
  from: Date,
  to: Date,
): Promise<AvailableSlot[]> {
  if (!booking.serviceId) {
    return Promise.resolve([]);
  }
  return env.reads.listAvailableSlots(env.tenantId, {
    serviceId: booking.serviceId,
    practitionerId: booking.practitionerId ?? null,
    from,
    to,
    limit: SLOT_LIMIT,
  });
}

function slotsOfDay(booking: BookingDraft, env: StepEnv): Promise<AvailableSlot[]> {
  if (!booking.day) {
    return Promise.resolve([]);
  }
  const bounds = dayBounds(booking.day, env.timeZone);
  const from = bounds.from > env.now ? bounds.from : env.now;
  return slotsBetween(booking, env, from, bounds.to);
}

function withBooking(context: ConversationContext, booking: BookingDraft): ConversationContext {
  return { ...context, booking };
}

export const bookService: Step = {
  id: "book_service",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const services = await env.reads.listServices(env.tenantId);
    if (services.length === 0) {
      return redirect("appointments_menu", context, [line("book_no_services")]);
    }
    const options = services.map((s) => choice(`svc:${s.id}`, literal(s.name)));
    return prompt(context, [line("book_service_prompt")], options);
  },
  async handle(input, context) {
    const serviceId = optionValue(input, "svc:");
    if (serviceId === null || !context.booking) {
      return retry("book_service", context);
    }
    return go("book_practitioner", withBooking(context, { ...context.booking, serviceId }));
  },
};

export const bookPractitioner: Step = {
  id: "book_practitioner",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const serviceId = context.booking?.serviceId;
    if (!serviceId) {
      return redirect("book_service", context);
    }
    const list = await env.reads.listPractitioners(env.tenantId, serviceId);
    const options = [
      ...list.map((p) => choice(`prac:${p.id}`, literal(p.name))),
      choice("prac:any", t("option_any_practitioner")),
    ];
    return prompt(context, [line("book_practitioner_prompt")], options);
  },
  async handle(input, context) {
    const id = optionValue(input, "prac:");
    if (id === null || !context.booking) {
      return retry("book_practitioner", context);
    }
    const practitionerId = id === "any" ? null : id;
    return go(
      "book_day",
      withBooking(context, { ...context.booking, practitionerId, dayOffset: 0 }),
    );
  },
};

export const bookDay: Step = {
  id: "book_day",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const booking = context.booking;
    if (!booking) {
      return redirect("appointments_menu", context);
    }
    const horizon = new Date(env.now.getTime() + HORIZON_DAYS * DAY_MS);
    const slots = await slotsBetween(booking, env, env.now, horizon);
    const days = [...new Set(slots.map((s) => localDate(s.startAt, env.timeZone)))].sort((a, b) =>
      a.localeCompare(b),
    );
    const offset = booking.dayOffset ?? 0;
    const page = days.slice(offset, offset + DAYS_PER_PAGE);
    if (page.length === 0) {
      return redirect("appointments_menu", context, [line("book_no_days")]);
    }
    const more = days.length > offset + DAYS_PER_PAGE ? [choice("day:more", t("option_more"))] : [];
    const options = page.map((d) => choice(`day:${d}`, literal(formatLocalDay(d, env.timeZone))));
    return prompt(context, [line("book_day_prompt")], [...options, ...more]);
  },
  async handle(input, context) {
    const booking = context.booking;
    const day = optionValue(input, "day:");
    if (!booking || day === null) {
      return retry("book_day", context);
    }
    if (day === "more") {
      const dayOffset = (booking.dayOffset ?? 0) + DAYS_PER_PAGE;
      return go("book_day", withBooking(context, { ...booking, dayOffset }));
    }
    return go("book_slot", withBooking(context, { ...booking, day, slotOffset: 0 }));
  },
};

export const bookSlot: Step = {
  id: "book_slot",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const booking = context.booking;
    if (!booking?.day) {
      return redirect("book_day", context);
    }
    const slots = await slotsOfDay(booking, env);
    const offset = booking.slotOffset ?? 0;
    const page = slots.slice(offset, offset + SLOTS_PER_PAGE);
    if (page.length === 0) {
      return redirect("book_day", withBooking(context, { ...booking, dayOffset: 0 }), [
        line("slot_taken"),
      ]);
    }
    const more =
      slots.length > offset + SLOTS_PER_PAGE ? [choice("slot:more", t("option_more"))] : [];
    const options = page.map((s) =>
      choice(
        `slot:${s.id}`,
        literal(`${formatTime(s.startAt, env.timeZone)} · ${s.practitionerName}`),
      ),
    );
    return prompt(context, [line("book_slot_prompt")], [...options, ...more]);
  },
  async handle(input, context) {
    const booking = context.booking;
    const slotId = optionValue(input, "slot:");
    if (!booking || slotId === null) {
      return retry("book_slot", context);
    }
    if (slotId === "more") {
      const slotOffset = (booking.slotOffset ?? 0) + SLOTS_PER_PAGE;
      return go("book_slot", withBooking(context, { ...booking, slotOffset }));
    }
    return go("book_confirm", withBooking(context, { ...booking, slotId }));
  },
};

function commandOf(booking: BookingDraft | undefined): AppointmentCommand | null {
  if (!booking?.slotId) {
    return null;
  }
  if (booking.kind === "book") {
    return { kind: "book", slotId: booking.slotId };
  }
  if (booking.kind === "reschedule" && booking.appointmentId) {
    return { kind: "reschedule", appointmentId: booking.appointmentId, slotId: booking.slotId };
  }
  return null;
}

function withoutSlot(booking: BookingDraft): BookingDraft {
  const { slotId: _slotId, ...rest } = booking;
  return rest;
}

function afterRequest(
  outcome: EffectOutcome,
  context: ConversationContext,
  env: StepEnv,
): HandleResult {
  if (outcome.ok) {
    const holdUntil = formatWhen(outcome.expiresAt ?? env.now, env.timeZone);
    return go("appointments_menu", context, [line("request_created", { hold_until: holdUntil })]);
  }
  if (outcome.failure === "slot_unavailable" && context.booking) {
    return go(
      "book_slot",
      withBooking(context, withoutSlot(context.booking)),
      failureLines(outcome),
    );
  }
  return go("appointments_menu", context, failureLines(outcome));
}

export const bookConfirm: Step = {
  id: "book_confirm",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const booking = context.booking;
    const slot = booking?.slotId
      ? (await slotsOfDay(booking, env)).find((s) => s.id === booking.slotId)
      : undefined;
    if (!booking || !slot) {
      return redirect("book_slot", context, [line("slot_taken")]);
    }
    const params = {
      service: slot.serviceName,
      when: formatWhen(slot.startAt, env.timeZone),
      practitioner: slot.practitionerName,
    };
    return prompt(
      context,
      [line("book_confirm_prompt", params)],
      [choice("book:confirm", t("option_confirm"))],
    );
  },
  async handle(input, context, env) {
    const command = commandOf(context.booking);
    if (!isOption(input, "book:confirm") || !command || !context.patientId) {
      return retry("book_confirm", context);
    }
    return {
      goto: "book_confirm",
      context,
      lines: [],
      effect: { kind: "request_appointment", medicalRecordId: context.patientId, command },
      onOutcome: (outcome) => afterRequest(outcome, context, env),
    };
  },
};
