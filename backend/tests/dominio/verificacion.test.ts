import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS } from "@/modules/bot-config/domain/bot-config";
import type { Random } from "@/modules/shared/domain/ports/random";
import {
  applyAttempt,
  type Challenge,
  effectiveChallenge,
  isLocked,
} from "@/modules/verification/domain/challenge";
import { drawPair, pairUsable } from "@/modules/verification/domain/draw";
import {
  answerMatches,
  QUESTION_BANK,
  questionById,
  type VerifiableRecord,
} from "@/modules/verification/domain/questions";

const FULL: VerifiableRecord = {
  id: "mr-1",
  birthDate: "1990-03-07",
  phone: "+57 300 123 4567",
  email: "juana.perez@gmail.com",
};
const DATE_ONLY: VerifiableRecord = {
  id: "mr-2",
  birthDate: "1985-12-24",
  phone: null,
  email: null,
};

function sequence(...values: number[]): Random {
  let i = 0;
  return { int: (max) => (values[i++] ?? 0) % max };
}

describe("verificacion: banco de preguntas", () => {
  it("cada pregunta tiene su texto predeterminado", () => {
    for (const question of QUESTION_BANK) {
      expect(Object.keys(DEFAULT_TEXTS), question.id).toContain(question.textKey);
    }
  });

  it("compara normalizando la respuesta", () => {
    expect(answerMatches("birth_day", FULL, " 07 ")).toBe(true);
    expect(answerMatches("birth_month", FULL, "3")).toBe(true);
    expect(answerMatches("birth_year", FULL, "1990")).toBe(true);
    expect(answerMatches("phone_last_4", FULL, "4567")).toBe(true);
    expect(answerMatches("phone_first_3", FULL, "300")).toBe(true);
    expect(answerMatches("phone_first_3", FULL, "573")).toBe(false);
    expect(answerMatches("birth_day", FULL, "8")).toBe(false);
    expect(answerMatches("birth_day", FULL, "")).toBe(false);
  });

  it("la pista de correo da las mismas opciones en cada llamada e incluye la verdadera", () => {
    const question = questionById("email_hint");
    const first = question?.options?.(FULL) ?? [];
    const second = question?.options?.(FULL) ?? [];
    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    const right = first.find((option) => answerMatches("email_hint", FULL, option.value));
    expect(right?.label).toBe("j•••@gmail.com");
  });

  it("los senuelos de correo comparten el dominio real, aunque sea poco comun", () => {
    const record = { ...FULL, id: "mr-9", email: "Zoe@clinica.co" };
    const options = questionById("email_hint")?.options?.(record) ?? [];
    expect(new Set(options.map((o) => o.value)).size).toBe(4);
    expect(options.every((o) => o.value.endsWith("@clinica.co"))).toBe(true);
    expect(options.map((o) => o.value)).toContain("z•••@clinica.co");
    expect(answerMatches("email_hint", record, "z•••@clinica.co")).toBe(true);
  });

  it("sin telefono ni correo solo quedan preguntas de fecha", () => {
    const available = QUESTION_BANK.filter((q) => q.isAvailable(DATE_ONLY)).map((q) => q.source);
    expect(new Set(available)).toEqual(new Set(["birth_date"]));
  });
});

describe("verificacion: sorteo del par", () => {
  it("con varias fuentes elige dos de fuentes distintas", () => {
    for (let seed = 0; seed < 20; seed++) {
      const pair = drawPair(FULL, sequence(seed, seed + 3));
      expect(pair).not.toBeNull();
      const [a, b] = (pair ?? []).map((id) => questionById(id)?.source);
      expect(a).not.toBe(b);
    }
  });

  it("solo con fecha elige dos preguntas distintas de fecha", () => {
    const pair = drawPair(DATE_ONLY, sequence(0, 0));
    expect(pair?.[0]).not.toBe(pair?.[1]);
    expect(pair?.every((id) => questionById(id)?.source === "birth_date")).toBe(true);
  });

  it("un par con una pregunta que ya no aplica no es usable", () => {
    expect(pairUsable(["birth_day", "phone_last_4"], FULL)).toBe(true);
    expect(pairUsable(["birth_day", "phone_last_4"], DATE_ONLY)).toBe(false);
    expect(pairUsable(["birth_day", "desconocida"], FULL)).toBe(false);
  });
});

describe("verificacion: intentos y bloqueo", () => {
  const now = new Date("2026-10-02T15:00:00.000Z");
  const policy = { maxAttempts: 3, lockMinutes: 30 };
  const base: Challenge = {
    id: "v1",
    tenantId: "t1",
    medicalRecordId: "mr-1",
    questionIds: ["birth_day", "phone_last_4"],
    failedAttempts: 0,
    lockedUntil: null,
  };
  const redraw = ["birth_year", "email_hint"] as const;

  it("cuenta fallos y bloquea al tercero con el mismo par", () => {
    let challenge = base;
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const step = applyAttempt(challenge, false, now, policy, redraw);
      challenge = step.challenge;
      results.push(step.outcome.result);
    }
    expect(results).toEqual(["failed", "failed", "locked"]);
    expect(challenge.lockedUntil).toEqual(new Date(now.getTime() + 30 * 60_000));
    expect(challenge.questionIds).toEqual(base.questionIds);
    expect(isLocked(challenge, now)).toBe(true);
  });

  it("al vencer el bloqueo vuelve a cero con el mismo par", () => {
    const locked = { ...base, failedAttempts: 3, lockedUntil: new Date(now.getTime() - 1) };
    const effective = effectiveChallenge(locked, now);
    expect(effective).toEqual({ ...base, failedAttempts: 0, lockedUntil: null });
  });

  it("el exito re-sortea el par y reinicia el contador", () => {
    const step = applyAttempt({ ...base, failedAttempts: 2 }, true, now, policy, redraw);
    expect(step.outcome).toEqual({ result: "verified", remainingAttempts: 3, lockedUntil: null });
    expect(step.challenge).toMatchObject({ failedAttempts: 0, questionIds: redraw });
  });

  it("un intento sobre un desafio bloqueado no cambia nada", () => {
    const locked = { ...base, failedAttempts: 3, lockedUntil: new Date(now.getTime() + 60_000) };
    const step = applyAttempt(locked, true, now, policy, redraw);
    expect(step.outcome.result).toBe("locked");
    expect(step.challenge).toEqual(locked);
  });
});
