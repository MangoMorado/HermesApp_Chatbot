import { describe, expect, it } from "vitest";
import { kbQuery, kbResults } from "@/modules/conversation/domain/steps/knowledge";
import { closed, mainMenu, verificationBlocked } from "@/modules/conversation/domain/steps/menu";
import { ctx, fakeReads, keysOf, makeEnv, opt, text } from "./flujo-support";

const HOURS = {
  id: "kb1",
  question: "¿Horarios?",
  answer: "Lunes a viernes 7 a 17",
  detail: "Sabados 8 a 12",
};
const PARKING = { id: "kb2", question: "¿Parqueadero?", answer: "Sí, gratuito", detail: null };

describe("flujo: menu principal", () => {
  it("ofrece Mis citas y Consultas", async () => {
    const entered = await mainMenu.enter(ctx(), makeEnv());
    expect(entered.kind === "prompt" && entered.options.map((o) => o.value)).toEqual([
      "menu:appointments",
      "menu:kb",
    ]);
  });

  it("Mis citas pide documento si no hay paciente verificado y va directo si lo hay", async () => {
    expect((await mainMenu.handle(opt("menu:appointments"), ctx(), makeEnv())).goto).toBe(
      "id_document_type",
    );
    expect(
      (await mainMenu.handle(opt("menu:appointments"), ctx({ patientId: "mr" }), makeEnv())).goto,
    ).toBe("appointments_menu");
    expect((await mainMenu.handle(opt("menu:kb"), ctx(), makeEnv())).goto).toBe("kb_query");
  });

  it("cierre y bloqueo solo dejan las opciones globales", async () => {
    for (const step of [closed, verificationBlocked]) {
      const entered = await step.enter(ctx(), makeEnv());
      expect(entered.kind === "prompt" && entered.options).toEqual([]);
    }
  });
});

describe("flujo: consultas generales", () => {
  const env = makeEnv(
    fakeReads({
      searchKnowledge: async (_t, query, max) =>
        query.includes("horario") ? [HOURS, PARKING].slice(0, max) : [],
      getKnowledge: async (_t, id) => [HOURS, PARKING].find((e) => e.id === id) ?? null,
    }),
  );

  it("muestra las respuestas y ofrece Ver mas solo para las que tienen detalle", async () => {
    const handled = await kbQuery.handle(text("horario de atencion"), ctx(), env);
    expect(handled.goto).toBe("kb_results");
    expect(keysOf(handled.lines)).toEqual([
      "literal:¿Horarios?\nLunes a viernes 7 a 17",
      "literal:¿Parqueadero?\nSí, gratuito",
    ]);
    const entered = await kbResults.enter(handled.context, env);
    expect(entered.kind === "prompt" && entered.options).toEqual([
      { value: "kb:detail:kb1", label: { key: "kb_see_more_label", append: "¿Horarios?" } },
      { value: "kb:another", label: { key: "kb_another" } },
    ]);
  });

  it("sin resultados avisa y ofrece otra consulta", async () => {
    const handled = await kbQuery.handle(text("precio"), ctx(), env);
    expect(keysOf(handled.lines)).toEqual(["kb_no_results"]);
    expect(handled.context.kbResults).toEqual([]);
  });

  it("Ver mas muestra el detalle; Otra consulta vuelve a preguntar", async () => {
    const context = ctx({ kbResults: [{ id: "kb1", question: "¿Horarios?" }] });
    const detail = await kbResults.handle(opt("kb:detail:kb1"), context, env);
    expect(keysOf(detail.lines)).toEqual(["literal:Sabados 8 a 12"]);
    expect((await kbResults.handle(opt("kb:another"), context, env)).goto).toBe("kb_query");
  });
});
