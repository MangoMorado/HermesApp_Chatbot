import type { ConversationReads } from "@/modules/conversation/domain/reads";
import type { BotLine } from "@/modules/conversation/domain/text";
import type {
  ConversationContext,
  EffectOutcome,
  PatientInput,
  StepEnv,
} from "@/modules/conversation/domain/types";
import type { Random } from "@/modules/shared/domain/ports/random";

/** Lunes 5 de octubre de 2026, 08:00 en Bogota. */
export const NOW = new Date("2026-10-05T13:00:00.000Z");
export const TZ = "America/Bogota";
export const firstRandom: Random = { int: () => 0 };

export function fakeReads(overrides: Partial<ConversationReads> = {}): ConversationReads {
  return {
    findPatient: async () => null,
    getPatient: async () => null,
    challenge: async () => null,
    searchKnowledge: async () => [],
    getKnowledge: async () => null,
    listServices: async () => [],
    listPractitioners: async () => [],
    listAvailableSlots: async () => [],
    listUpcomingAppointments: async () => [],
    ...overrides,
  };
}

export function makeEnv(
  reads: ConversationReads = fakeReads(),
  overrides: Partial<StepEnv> = {},
): StepEnv {
  return {
    tenantId: "tenant-1",
    now: NOW,
    timeZone: TZ,
    params: { kbMaxResults: 3 },
    random: firstRandom,
    reads,
    ...overrides,
  };
}

export function ctx(extra: Partial<ConversationContext> = {}): ConversationContext {
  return { turn: 1, options: [], input: "none", ...extra };
}

export const opt = (value: string): PatientInput => ({
  kind: "option",
  value,
  label: { literal: value },
});
export const text = (value: string): PatientInput => ({ kind: "text", text: value });

/** Claves de los mensajes (o `literal:<texto>`), para comparar sin renderizar. */
export function keysOf(lines: readonly BotLine[]): string[] {
  return lines.map((l) => ("key" in l.text ? l.text.key : `literal:${l.text.literal}`));
}

export const okOutcome = (
  extra: Partial<Extract<EffectOutcome, { ok: true }>> = {},
): EffectOutcome => ({
  ok: true,
  ...extra,
});
