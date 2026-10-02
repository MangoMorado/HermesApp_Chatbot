import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS } from "@/modules/bot-config/domain/bot-config";
import { runTurn, startConversation, type TurnOutput } from "@/modules/conversation/domain/engine";
import { STEPS } from "@/modules/conversation/domain/steps";
import { CONVERSATION_TEXT_KEYS } from "@/modules/conversation/domain/text";
import type { Effect, EffectOutcome } from "@/modules/conversation/domain/types";
import { fakeReads, makeEnv, NOW } from "./flujo-support";

const env = makeEnv(
  fakeReads({
    listServices: async () => [{ id: "svc1", name: "Medicina general" }],
    listPractitioners: async () => [{ id: "p1", name: "Dra. Ruiz" }],
    listAvailableSlots: async (_t, f) =>
      [
        {
          id: "s1",
          startAt: new Date(NOW.getTime() + 3_600_000),
          serviceName: "Medicina general",
          practitionerName: "Dra. Ruiz",
        },
      ].filter((s) => s.startAt >= f.from && s.startAt < f.to),
  }),
);

function pick(out: TurnOutput, value: string): { optionId: string } {
  const option = out.state.context.options.find((o) => o.value === value);
  if (!option) {
    throw new Error(`Sin opcion ${value} en ${out.state.step}`);
  }
  return { optionId: option.id };
}

describe("flujo: recorrido", () => {
  it("todas las claves del chat tienen texto predeterminado", () => {
    expect(CONVERSATION_TEXT_KEYS.filter((key) => !(key in DEFAULT_TEXTS))).toEqual([]);
  });

  it("documento nuevo → pre-registro → agendar declara una solicitud book", async () => {
    const effects: Effect[] = [];
    const runEffect = async (effect: Effect): Promise<EffectOutcome> => {
      effects.push(effect);
      if (effect.kind === "pre_register") return { ok: true, medicalRecordId: "mr-new" };
      if (effect.kind === "request_appointment")
        return { ok: true, expiresAt: new Date(NOW.getTime() + 3_600_000) };
      return { ok: true };
    };
    let out = await startConversation(env, STEPS);
    const say = async (message: { optionId: string } | { text: string }) => {
      out = await runTurn(out.state, message, env, runEffect, STEPS);
      return out;
    };
    await say(pick(out, "menu:appointments"));
    await say(pick(out, "doc:CC"));
    await say({ text: "99887766" });
    await say(pick(out, "privacy:accept"));
    for (const value of ["Ana", "Paz", "1990-03-07", "3001234567"]) {
      await say({ text: value });
    }
    await say(pick(out, "prereg:skip"));
    await say(pick(out, "prereg:confirm"));
    expect(out.state.step).toBe("appointments_menu");
    await say(pick(out, "appt:book"));
    await say(pick(out, "svc:svc1"));
    await say(pick(out, "prac:any"));
    await say(pick(out, "day:2026-10-05"));
    await say(pick(out, "slot:s1"));
    await say(pick(out, "book:confirm"));
    expect(effects.map((e) => e.kind)).toEqual(["pre_register", "request_appointment"]);
    expect(effects[1]).toEqual({
      kind: "request_appointment",
      medicalRecordId: "mr-new",
      command: { kind: "book", slotId: "s1" },
    });
    expect(out.state.step).toBe("appointments_menu");
    expect(out.state.context.preRegistration).toBeUndefined();
  });
});
