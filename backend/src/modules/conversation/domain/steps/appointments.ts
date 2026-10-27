import { formatWhen } from "../format";
import type { UpcomingAppointment } from "../reads";
import { choice, go, isOption, optionValue, prompt, redirect, resetFlow, retry } from "../step-kit";
import { type BotLine, line, literal, t } from "../text";
import type { ConversationContext, EffectOutcome, HandleResult, Step, StepEnv } from "../types";

const MAX_APPOINTMENTS = 10;

/** Traduce el fallo de una solicitud al mensaje del bot (sin codigos nuevos, §2). */
export function failureLines(outcome: EffectOutcome): BotLine[] {
  if (outcome.ok) {
    return [];
  }
  switch (outcome.failure) {
    case "slot_unavailable":
      return [line("slot_taken")];
    case "pending_limit_reached":
      return [line("pending_limit", { max: String(outcome.max ?? "") })];
    case "appointment_change_pending":
      return [line("change_pending")];
    case "not_available":
      return [line("appointment_unavailable")];
    case "document_taken":
      return [line("generic_error")];
  }
}

export const appointmentsMenu: Step = {
  id: "appointments_menu",
  globals: "full",
  echo: "label",
  enter(context) {
    if (!context.patientId) {
      return redirect("id_document_type", resetFlow(context));
    }
    const options = [
      choice("appt:book", t("option_book")),
      choice("appt:reschedule", t("option_reschedule")),
      choice("appt:cancel", t("option_cancel_appointment")),
    ];
    return prompt(resetFlow(context), [line("appointments_menu_prompt")], options);
  },
  handle(input, context) {
    if (isOption(input, "appt:book")) {
      return go("book_service", { ...context, booking: { kind: "book" } });
    }
    if (isOption(input, "appt:reschedule")) {
      return go("pick_appointment", { ...context, booking: { kind: "reschedule" } });
    }
    if (isOption(input, "appt:cancel")) {
      return go("pick_appointment", { ...context, booking: { kind: "cancel" } });
    }
    return retry("appointments_menu", context);
  },
};

function appointmentLabel(appointment: UpcomingAppointment, timeZone: string): string {
  return `${formatWhen(appointment.startAt, timeZone)} · ${appointment.serviceName} · ${appointment.practitionerName}`;
}

async function upcoming(
  context: ConversationContext,
  env: StepEnv,
): Promise<UpcomingAppointment[]> {
  return context.patientId
    ? env.reads.listUpcomingAppointments(env.tenantId, context.patientId, env.now)
    : [];
}

export const pickAppointment: Step = {
  id: "pick_appointment",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const list = (await upcoming(context, env)).slice(0, MAX_APPOINTMENTS);
    if (list.length === 0) {
      return redirect("appointments_menu", context, [line("no_upcoming_appointments")]);
    }
    const options = list.map((a) =>
      choice(`pick:${a.id}`, literal(appointmentLabel(a, env.timeZone))),
    );
    return prompt(context, [line("pick_appointment_prompt")], options);
  },
  async handle(input, context, env) {
    const id = optionValue(input, "pick:");
    const kind = context.booking?.kind;
    if (id === null || !kind) {
      return retry("pick_appointment", context);
    }
    const found = (await upcoming(context, env)).find((a) => a.id === id);
    if (!found) {
      return go("appointments_menu", context, [line("appointment_unavailable")]);
    }
    if (kind === "cancel") {
      return go("cancel_confirm", { ...context, booking: { kind, appointmentId: id } });
    }
    const booking = {
      kind: "reschedule" as const,
      appointmentId: id,
      serviceId: found.serviceId,
      practitionerId: null,
      dayOffset: 0,
    };
    return go("book_day", { ...context, booking });
  },
};

export const cancelConfirm: Step = {
  id: "cancel_confirm",
  globals: "full",
  echo: "label",
  async enter(context, env) {
    const appointmentId = context.booking?.appointmentId;
    const found = (await upcoming(context, env)).find((a) => a.id === appointmentId);
    if (!found) {
      return redirect("appointments_menu", context, [line("appointment_unavailable")]);
    }
    const when = formatWhen(found.startAt, env.timeZone);
    return prompt(
      context,
      [line("cancel_confirm_prompt", { when })],
      [choice("cancel:confirm", t("option_confirm"))],
    );
  },
  handle(input, context) {
    const appointmentId = context.booking?.appointmentId;
    if (!isOption(input, "cancel:confirm") || !appointmentId || !context.patientId) {
      return retry("cancel_confirm", context);
    }
    return {
      goto: "cancel_confirm",
      context,
      lines: [],
      effect: {
        kind: "request_appointment",
        medicalRecordId: context.patientId,
        command: { kind: "cancel", appointmentId },
      },
      onOutcome: (outcome): HandleResult =>
        go(
          "appointments_menu",
          context,
          outcome.ok ? [line("cancel_request_created")] : failureLines(outcome),
        ),
    };
  },
};
