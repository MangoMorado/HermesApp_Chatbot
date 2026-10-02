import { describe, expect, it, vi } from "vitest";
import { NAV, runTurn, startConversation } from "@/modules/conversation/domain/engine";
import { parseIncomingMessage } from "@/modules/conversation/domain/message-input";
import { choice, go, prompt, retry } from "@/modules/conversation/domain/step-kit";
import { line, literal, t } from "@/modules/conversation/domain/text";
import type { Step, StepRegistry } from "@/modules/conversation/domain/types";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { keysOf, makeEnv } from "./flujo-support";

const menu: Step = {
  id: "main_menu",
  globals: "full",
  echo: "label",
  enter: async (c) => prompt(c, [line("menu_prompt")], [choice("menu:kb", t("option_kb"))]),
  handle: async (input, c) =>
    input.kind === "option" && input.value === "menu:kb"
      ? go("kb_query", c)
      : retry("main_menu", c),
};
const query: Step = {
  id: "kb_query",
  globals: "full",
  echo: "redacted",
  enter: async (c) => prompt(c, [line("kb_prompt")], [], "text"),
  handle: async (input, c) =>
    go("kb_query", c, [{ text: literal(input.kind === "text" ? "eco" : "?") }]),
};
const closed: Step = {
  id: "closed",
  globals: "full",
  echo: "label",
  enter: async (c) => prompt(c, [line("closed_prompt")], []),
  handle: async (_i, c) => retry("closed", c),
};
const steps = { main_menu: menu, kb_query: query, closed } as unknown as StepRegistry;
const noEffect = vi.fn(async () => ({ ok: true as const }));

describe("flujo: motor", () => {
  it("arranca con la bienvenida y el menu, con Asesor pero sin Menu", async () => {
    const start = await startConversation(makeEnv(), steps);
    expect(keysOf(start.lines)).toEqual(["welcome", "menu_prompt"]);
    expect(start.state.step).toBe("main_menu");
    expect(start.state.context.options.map((o) => o.value)).toEqual(["menu:kb", NAV.advisor]);
    expect(start.state.context.options.map((o) => o.id)).toEqual(["1.1", "1.2"]);
    expect(start.echo).toBeNull();
  });

  it("una opcion de otro turno es stale_option y no toca el estado", async () => {
    const start = await startConversation(makeEnv(), steps);
    await expect(
      runTurn(start.state, { optionId: "9.1" }, makeEnv(), noEffect, steps),
    ).rejects.toMatchObject({
      constructor: ConflictError,
      details: { reason: "stale_option" },
    });
  });

  it("texto donde se esperaba opcion repite el turno con invalid_option", async () => {
    const start = await startConversation(makeEnv(), steps);
    const out = await runTurn(start.state, { text: "hola" }, makeEnv(), noEffect, steps);
    expect(keysOf(out.lines)).toEqual(["invalid_option", "menu_prompt"]);
    expect(out.echo).toEqual({ text: { literal: "[redactado]" }, redacted: true });
    expect(out.state.context.turn).toBe(2);
  });

  it("la eleccion se guarda con su etiqueta y el texto libre redactado", async () => {
    const start = await startConversation(makeEnv(), steps);
    const toQuery = await runTurn(start.state, { optionId: "1.1" }, makeEnv(), noEffect, steps);
    expect(toQuery.echo).toEqual({ text: t("option_kb"), redacted: false });
    expect(toQuery.state.context.input).toBe("text");
    expect(toQuery.state.context.options.map((o) => o.value)).toEqual([NAV.menu, NAV.advisor]);
    const typed = await runTurn(
      toQuery.state,
      { text: "dolor de pecho" },
      makeEnv(),
      noEffect,
      steps,
    );
    expect(typed.echo?.redacted).toBe(true);
  });

  it("Asesor crea el handoff sin expediente si no verifico y cierra", async () => {
    const start = await startConversation(makeEnv(), steps);
    const runEffect = vi.fn(async () => ({ ok: true as const }));
    const out = await runTurn(start.state, { optionId: "1.2" }, makeEnv(), runEffect, steps);
    expect(runEffect).toHaveBeenCalledWith({
      kind: "handoff",
      reason: "requested",
      medicalRecordId: null,
    });
    expect(out.state.step).toBe("closed");
    expect(keysOf(out.lines)).toEqual(["handoff_created", "closed_prompt"]);
  });

  it("valida el cuerpo del mensaje", () => {
    expect(parseIncomingMessage({ option_id: "1.1" })).toEqual({ optionId: "1.1" });
    expect(parseIncomingMessage({ text: "  hola " })).toEqual({ text: "hola" });
    expect(() => parseIncomingMessage({})).toThrow(ValidationError);
    expect(() => parseIncomingMessage({ option_id: "1", text: "x" })).toThrow(ValidationError);
    expect(() => parseIncomingMessage({ text: "x".repeat(501) })).toThrow(ValidationError);
    expect(() => parseIncomingMessage({ text: "x", tenant_id: "otro" })).toThrow(ValidationError);
  });
});
