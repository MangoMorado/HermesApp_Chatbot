import { describe, expect, it } from "vitest";
import {
  idDocumentNumber,
  idDocumentType,
} from "@/modules/conversation/domain/steps/identification";
import { verifyQuestion } from "@/modules/conversation/domain/steps/verification";
import type { Challenge } from "@/modules/verification/domain/challenge";
import { ctx, fakeReads, keysOf, makeEnv, NOW, okOutcome, opt, text } from "./flujo-support";

const RECORD = { id: "mr-1", birthDate: "1990-03-07", phone: "3001234567", email: null };
const CHALLENGE: Challenge = {
  id: "v1",
  tenantId: "tenant-1",
  medicalRecordId: "mr-1",
  questionIds: ["birth_day", "phone_last_4"],
  failedAttempts: 0,
  lockedUntil: null,
};
const reads = (challenge: Challenge | null = null) =>
  fakeReads({
    findPatient: async (_t, type, number) =>
      type === "CC" && number === "1020304050" ? RECORD : null,
    getPatient: async (_t, id) => (id === RECORD.id ? RECORD : null),
    challenge: async () => challenge,
  });

describe("flujo: identificacion", () => {
  it("elige tipo y normaliza el numero", async () => {
    const typed = await idDocumentType.handle(opt("doc:CC"), ctx(), makeEnv());
    expect(typed).toMatchObject({ goto: "id_document_number", context: { documentType: "CC" } });
    const handled = await idDocumentNumber.handle(
      text("1.020.304.050"),
      typed.context,
      makeEnv(reads(CHALLENGE)),
    );
    expect(handled.goto).toBe("verify_question");
    expect(handled.context.verification).toEqual({
      medicalRecordId: "mr-1",
      questionIds: CHALLENGE.questionIds,
      index: 0,
    });
    expect(handled.effect).toBeUndefined();
  });

  it("un numero invalido repite con su aviso", async () => {
    const handled = await idDocumentNumber.handle(
      text("12"),
      ctx({ documentType: "CC" }),
      makeEnv(reads()),
    );
    expect(keysOf(handled.lines)).toEqual(["id_document_number_invalid"]);
  });

  it("sin desafio sortea y lo abre con un efecto; el par guardado gana", async () => {
    const handled = await idDocumentNumber.handle(
      text("1020304050"),
      ctx({ documentType: "CC" }),
      makeEnv(reads()),
    );
    expect(handled.effect).toMatchObject({ kind: "open_challenge", medicalRecordId: "mr-1" });
    const stored = ["birth_year", "phone_first_3"] as const;
    const next = handled.onOutcome?.(okOutcome({ questionIds: stored }));
    expect(next?.context.verification?.questionIds).toEqual(stored);
  });

  it("bloqueado o sin preguntas posibles va al bloqueo con su motivo", async () => {
    const locked = {
      ...CHALLENGE,
      failedAttempts: 3,
      lockedUntil: new Date(NOW.getTime() + 60_000),
    };
    const blocked = await idDocumentNumber.handle(
      text("1020304050"),
      ctx({ documentType: "CC" }),
      makeEnv(reads(locked)),
    );
    expect(blocked).toMatchObject({
      goto: "verification_blocked",
      context: { handoffReason: "verification_locked" },
    });
    expect(keysOf(blocked.lines)).toEqual(["verify_locked"]);

    const unusable = { ...CHALLENGE, questionIds: ["email_hint", "birth_day"] as const };
    const unverifiable = await idDocumentNumber.handle(
      text("1020304050"),
      ctx({ documentType: "CC" }),
      makeEnv(reads(unusable)),
    );
    expect(unverifiable.context.handoffReason).toBe("unverifiable");
  });

  it("documento desconocido ofrece el pre-registro", async () => {
    const handled = await idDocumentNumber.handle(
      text("999999"),
      ctx({ documentType: "TI" }),
      makeEnv(reads()),
    );
    expect(handled.goto).toBe("privacy_notice");
    expect(handled.context.preRegistration).toEqual({
      documentType: "TI",
      documentNumber: "999999",
      field: "given_names",
    });
    expect(keysOf(handled.lines)).toEqual(["prereg_not_found"]);
  });
});

describe("flujo: verificacion", () => {
  const draft = {
    medicalRecordId: "mr-1",
    questionIds: ["birth_day", "phone_last_4"] as const,
    index: 0 as const,
  };

  it("la primera respuesta solo deja si fue correcta, nunca el valor", async () => {
    const handled = await verifyQuestion.handle(
      text("07"),
      ctx({ verification: draft }),
      makeEnv(reads()),
    );
    expect(handled.context.verification).toEqual({ ...draft, index: 1, firstCorrect: true });
    expect(JSON.stringify(handled.context)).not.toContain("07");
  });

  it("la segunda declara el intento con exito solo si ambas fueron correctas", async () => {
    const second = { ...draft, index: 1 as const, firstCorrect: false };
    const handled = await verifyQuestion.handle(
      text("4567"),
      ctx({ verification: second }),
      makeEnv(reads()),
    );
    expect(handled.effect).toEqual({
      kind: "verification_attempt",
      medicalRecordId: "mr-1",
      success: false,
    });
  });

  it("traduce el resultado del intento", async () => {
    const second = ctx({ verification: { ...draft, index: 1, firstCorrect: true } });
    const handled = await verifyQuestion.handle(text("4567"), second, makeEnv(reads()));
    const verified = handled.onOutcome?.(
      okOutcome({ verification: { result: "verified", remainingAttempts: 3, lockedUntil: null } }),
    );
    expect(verified).toMatchObject({ goto: "appointments_menu", context: { patientId: "mr-1" } });
    expect(verified?.context.verification).toBeUndefined();

    const failed = handled.onOutcome?.(
      okOutcome({ verification: { result: "failed", remainingAttempts: 2, lockedUntil: null } }),
    );
    expect(failed?.goto).toBe("verify_question");
    expect(failed?.context.verification).toEqual(draft);
    expect(failed?.lines[0]).toEqual({
      text: { key: "verify_failed", params: { remaining: "2" } },
    });

    const until = new Date(NOW.getTime() + 30 * 60_000);
    const locked = handled.onOutcome?.(
      okOutcome({ verification: { result: "locked", remainingAttempts: 0, lockedUntil: until } }),
    );
    expect(locked).toMatchObject({
      goto: "verification_blocked",
      context: { handoffReason: "verification_locked" },
    });
  });

  it("una pregunta de opciones lista sus opciones con prefijo ans:", async () => {
    const months = { ...draft, questionIds: ["birth_month", "phone_last_4"] as const };
    const entered = await verifyQuestion.enter(ctx({ verification: months }), makeEnv(reads()));
    expect(entered.kind === "prompt" && entered.options).toHaveLength(12);
    expect(entered.kind === "prompt" && entered.options[2]?.value).toBe("ans:3");
    const handled = await verifyQuestion.handle(
      opt("ans:3"),
      ctx({ verification: months }),
      makeEnv(reads()),
    );
    expect(handled.context.verification?.firstCorrect).toBe(true);
  });
});
