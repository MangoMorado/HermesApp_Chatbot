import { describe, expect, it } from "vitest";
import { parseField } from "@/modules/conversation/domain/pre-registration-fields";
import {
  preregConfirm,
  preregField,
  privacyNotice,
} from "@/modules/conversation/domain/steps/pre-registration";
import type { PreRegistrationDraft } from "@/modules/conversation/domain/types";
import { ctx, keysOf, makeEnv, okOutcome, opt, text } from "./flujo-support";

const START: PreRegistrationDraft = {
  documentType: "CC",
  documentNumber: "99887766",
  field: "given_names",
};
const FULL: PreRegistrationDraft = {
  ...START,
  field: "email",
  givenNames: "Ana",
  familyNames: "Paz",
  birthDate: "1990-03-07",
  phone: "3001234567",
  email: null,
};

describe("flujo: pre-registro", () => {
  it("sin aceptar el aviso de datos vuelve al menu y descarta el borrador", async () => {
    const declined = await privacyNotice.handle(
      opt("privacy:decline"),
      ctx({ preRegistration: START }),
      makeEnv(),
    );
    expect(declined.goto).toBe("main_menu");
    expect(declined.context.preRegistration).toBeUndefined();
    expect(keysOf(declined.lines)).toEqual(["privacy_declined"]);
    const accepted = await privacyNotice.handle(
      opt("privacy:accept"),
      ctx({ preRegistration: START }),
      makeEnv(),
    );
    expect(accepted.goto).toBe("prereg_field");
  });

  it("pide los campos en orden y valida cada uno", async () => {
    let context = ctx({ preRegistration: START });
    for (const value of ["Ana", "Paz", "1990-03-07", "300 123 4567"]) {
      const handled = await preregField.handle(text(value), context, makeEnv());
      expect(handled.goto).toBe("prereg_field");
      context = handled.context;
    }
    expect(context.preRegistration).toMatchObject({ field: "email", phone: "3001234567" });
    const skipped = await preregField.handle(opt("prereg:skip"), context, makeEnv());
    expect(skipped).toMatchObject({
      goto: "prereg_confirm",
      context: { preRegistration: { email: null } },
    });
    const invalid = await preregField.handle(
      text("2099-01-01"),
      ctx({ preRegistration: { ...START, field: "birth_date" } }),
      makeEnv(),
    );
    expect(keysOf(invalid.lines)).toEqual(["prereg_invalid"]);
  });

  it("la fecha de nacimiento pide input date y el correo ofrece Omitir", async () => {
    const date = await preregField.enter(
      ctx({ preRegistration: { ...START, field: "birth_date" } }),
      makeEnv(),
    );
    expect(date.kind === "prompt" && date.input).toBe("date");
    const email = await preregField.enter(
      ctx({ preRegistration: { ...START, field: "email" } }),
      makeEnv(),
    );
    expect(email.kind === "prompt" && email.options.map((o) => o.value)).toEqual(["prereg:skip"]);
  });

  it("el resumen va redactado y confirmar declara el pre-registro", async () => {
    const entered = await preregConfirm.enter(ctx({ preRegistration: FULL }), makeEnv());
    expect(entered.lines[0]?.redacted).toBe(true);
    const handled = await preregConfirm.handle(
      opt("prereg:confirm"),
      ctx({ preRegistration: FULL }),
      makeEnv(),
    );
    expect(handled.effect).toEqual({
      kind: "pre_register",
      data: {
        documentType: "CC",
        documentNumber: "99887766",
        givenNames: "Ana",
        familyNames: "Paz",
        birthDate: "1990-03-07",
        phone: "3001234567",
        email: null,
      },
    });
    const done = handled.onOutcome?.(okOutcome({ medicalRecordId: "mr-new" }));
    expect(done).toMatchObject({ goto: "appointments_menu", context: { patientId: "mr-new" } });
    expect(done?.context.preRegistration).toBeUndefined();
    const taken = handled.onOutcome?.({ ok: false, failure: "document_taken" });
    expect(taken?.goto).toBe("id_document_type");
  });

  it("valida los campos para la UX", () => {
    expect(parseField("given_names", "  Ana   María ", "2026-10-05")).toBe("Ana María");
    expect(parseField("phone", "+57 300 123 4567", "2026-10-05")).toBe("3001234567");
    expect(parseField("phone", "6011234567", "2026-10-05")).toBeNull();
    expect(parseField("birth_date", "1990-02-30", "2026-10-05")).toBeNull();
    expect(parseField("email", "Ana@Correo.com", "2026-10-05")).toBe("ana@correo.com");
  });
});
