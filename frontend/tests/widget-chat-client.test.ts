import { describe, expect, it, vi } from "vitest";
import { createChatClient } from "@/widget/chat-client";
import { WidgetApiError } from "@/widget/fetcher";
import type { SessionManager } from "@/widget/session";
import type { ConversationHistory, ConversationTurn, WidgetApi } from "@/widget/widget-api";

const AT = "2026-10-13T15:00:00.000Z";
const T1 = { accessToken: "t1", conversationSecret: "s1" };
const T2 = { accessToken: "t2", conversationSecret: "s2" };

const WELCOME: ConversationHistory = {
  messages: [{ author: "bot", text: "Hola, soy el asistente.", redacted: false, created_at: AT }],
  options: [{ id: "1.1", label: "Agendar una cita" }],
  input: "none",
};

const ASK_DOCUMENT: ConversationTurn = {
  messages: ["Escribe tu número de documento."],
  options: [{ id: "2.1", label: "Volver al menú" }],
  input: "text",
};

function apiError(status: number, details?: Record<string, unknown>, message = "error") {
  return new WidgetApiError(status, { error: { code: "x", message, details } }, `HTTP ${status}`);
}

function setup(overrides: Partial<WidgetApi> = {}) {
  const api = {
    openSession: vi.fn<WidgetApi["openSession"]>(),
    refreshSession: vi.fn<WidgetApi["refreshSession"]>(),
    getConversation: vi.fn<WidgetApi["getConversation"]>(async () => WELCOME),
    sendMessage: vi.fn<WidgetApi["sendMessage"]>(async () => ASK_DOCUMENT),
    ...overrides,
  };
  const session = {
    credentials: vi.fn<SessionManager["credentials"]>(async () => T1),
    reopen: vi.fn<SessionManager["reopen"]>(async () => T2),
    clear: vi.fn<SessionManager["clear"]>(),
    expired: vi.fn<SessionManager["expired"]>(() => false),
  };
  let keys = 0;
  const client = createChatClient({ api, session, newKey: () => `key-${++keys}` });
  return { api, session, client };
}

/** Historial tras elegir una opción: el backend guarda la etiqueta del paciente (o `[redactado]`). */
function afterOption(text: string): ConversationHistory {
  return {
    ...WELCOME,
    messages: [...WELCOME.messages, { author: "patient", text, redacted: false, created_at: AT }],
  };
}

function historyThen(...next: ConversationHistory[]) {
  const mock = vi.fn<WidgetApi["getConversation"]>().mockResolvedValueOnce(WELCOME);
  for (const history of next) {
    mock.mockResolvedValueOnce(history);
  }
  return mock;
}

const AGENDAR = { kind: "option", option: { id: "1.1", label: "Agendar una cita" } } as const;

describe("cliente del chat", () => {
  it("load pinta el historial, las opciones y la entrada del turno", async () => {
    const { client } = setup();
    const view = await client.load();
    expect(view.messages).toEqual([{ id: "m0", author: "bot", text: "Hola, soy el asistente." }]);
    expect(view.options).toEqual(WELCOME.options);
    expect(view.input).toBe("none");
    expect(client.view()).toBe(view);
  });

  it.each([401, 404])("load reabre la sesión una vez si el backend responde %i", async (status) => {
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockRejectedValueOnce(apiError(status))
      .mockResolvedValueOnce(WELCOME);
    const { session, client } = setup({ getConversation });
    await client.load();
    expect(session.reopen).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(2);
    expect(getConversation).toHaveBeenLastCalledWith(T1);
  });

  it("enviar una opción añade el eco del historial y las líneas del bot", async () => {
    const getConversation = historyThen(afterOption("Agendar una cita"));
    const { api, client } = setup({ getConversation });
    await client.load();
    const outcome = await client.send(AGENDAR);
    expect(api.sendMessage).toHaveBeenCalledWith(T1, { option_id: "1.1" }, "key-1");
    expect(outcome.kind).toBe("turn");
    expect(client.view().messages.map((m) => `${m.author}:${m.text}`)).toEqual([
      "bot:Hola, soy el asistente.",
      "patient:Agendar una cita",
      "bot:Escribe tu número de documento.",
    ]);
    expect(client.view().input).toBe("text");
    expect(new Set(client.view().messages.map((m) => m.id)).size).toBe(3);
  });

  it("el eco de una opción redactada por el backend no muestra la etiqueta elegida", async () => {
    const getConversation = historyThen(afterOption("[redactado]"));
    const { client } = setup({ getConversation });
    await client.load();
    await client.send({ kind: "option", option: { id: "v.3", label: "Marzo" } });
    const texts = client.view().messages.map((m) => m.text);
    expect(texts).toContain("[redactado]");
    expect(texts).not.toContain("Marzo");
  });

  it("si falla la lectura del eco de una opción, no se pinta eco", async () => {
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockRejectedValueOnce(apiError(0));
    const { client } = setup({ getConversation });
    await client.load();
    await client.send(AGENDAR);
    expect(client.view().messages.map((m) => m.author)).toEqual(["bot", "bot"]);
  });

  it("con la sesión vencida no envía el turno: reabre y recarga", async () => {
    const { api, session, client } = setup();
    session.expired.mockReturnValue(true);
    await client.load();
    const outcome = await client.send(AGENDAR);
    expect(outcome.kind).toBe("reopened");
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(session.reopen).toHaveBeenCalledTimes(1);
    expect(api.getConversation).toHaveBeenCalledTimes(2);
  });

  it("el eco del texto libre es el que guardó el backend, no lo que se escribió", async () => {
    const afterText: ConversationHistory = {
      ...WELCOME,
      messages: [
        ...WELCOME.messages,
        { author: "patient", text: "CC ••••5678", redacted: false, created_at: AT },
        { author: "bot", text: "[redactado]", redacted: true, created_at: AT },
      ],
    };
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockResolvedValueOnce(afterText);
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => ({
      messages: ["Confirma tus datos: Ana Pérez."],
      options: [],
      input: "none" as const,
    }));
    const { api, client } = setup({ getConversation, sendMessage });
    await client.load();
    await client.send({ kind: "text", text: "12345678" });
    expect(api.sendMessage).toHaveBeenCalledWith(T1, { text: "12345678" }, "key-1");
    const texts = client.view().messages.map((m) => m.text);
    expect(texts).toEqual([
      "Hola, soy el asistente.",
      "CC ••••5678",
      "Confirma tus datos: Ana Pérez.",
    ]);
    expect(texts).not.toContain("12345678");
  });

  it("si no se puede leer el eco, igual muestra las líneas del bot", async () => {
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockRejectedValueOnce(apiError(0));
    const { client } = setup({ getConversation });
    await client.load();
    const outcome = await client.send({ kind: "text", text: "hola" });
    expect(outcome.kind).toBe("turn");
    expect(client.view().messages.at(-1)?.text).toBe("Escribe tu número de documento.");
  });

  it("tras un fallo de red, reintentar el mismo envío reutiliza la Idempotency-Key", async () => {
    const sendMessage = vi
      .fn<WidgetApi["sendMessage"]>()
      .mockRejectedValueOnce(apiError(0))
      .mockResolvedValueOnce(ASK_DOCUMENT)
      .mockResolvedValueOnce(ASK_DOCUMENT);
    const { client } = setup({ sendMessage });
    await client.load();
    await expect(client.send(AGENDAR)).rejects.toMatchObject({ status: 0 });
    await client.send(AGENDAR);
    await client.send({ kind: "option", option: { id: "2.1", label: "Volver al menú" } });
    expect(sendMessage.mock.calls.map((call) => call[2])).toEqual(["key-1", "key-1", "key-2"]);
  });

  it("tras un fallo de red, un envío distinto usa otra clave", async () => {
    const sendMessage = vi
      .fn<WidgetApi["sendMessage"]>()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce(ASK_DOCUMENT);
    const { client } = setup({ sendMessage });
    await client.load();
    await expect(client.send(AGENDAR)).rejects.toMatchObject({ status: 503 });
    await client.send({ kind: "text", text: "otra cosa" });
    expect(sendMessage.mock.calls.map((call) => call[2])).toEqual(["key-1", "key-2"]);
  });

  it("409 stale_option recarga el turno vigente", async () => {
    const current: ConversationHistory = { ...WELCOME, options: [{ id: "3.1", label: "Menú" }] };
    const getConversation = vi
      .fn<WidgetApi["getConversation"]>()
      .mockResolvedValueOnce(WELCOME)
      .mockResolvedValueOnce(current);
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(409, { reason: "stale_option" });
    });
    const { client } = setup({ getConversation, sendMessage });
    await client.load();
    const outcome = await client.send(AGENDAR);
    expect(outcome.kind).toBe("stale");
    expect(client.view().options).toEqual([{ id: "3.1", label: "Menú" }]);
  });

  it.each([401, 404])(
    "%i al enviar abre sesión nueva, recarga y no reenvía el turno",
    async (status) => {
      const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
        throw apiError(status);
      });
      const { api, session, client } = setup({ sendMessage });
      await client.load();
      const outcome = await client.send(AGENDAR);
      expect(outcome.kind).toBe("reopened");
      expect(session.reopen).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(api.getConversation).toHaveBeenCalledTimes(2);
    },
  );

  it("422 devuelve el mensaje del backend y deja el turno como estaba", async () => {
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(422, { field: "text" }, "text debe tener entre 1 y 500 caracteres");
    });
    const { client } = setup({ sendMessage });
    const before = await client.load();
    const outcome = await client.send({ kind: "text", text: "x" });
    expect(outcome).toEqual({
      kind: "invalid",
      message: "text debe tener entre 1 y 500 caracteres",
    });
    expect(client.view()).toBe(before);
  });

  it("403 se propaga para que la interfaz lo muestre como terminal", async () => {
    const sendMessage = vi.fn<WidgetApi["sendMessage"]>(async () => {
      throw apiError(403);
    });
    const { client } = setup({ sendMessage });
    await client.load();
    await expect(client.send(AGENDAR)).rejects.toMatchObject({ status: 403 });
  });

  it("un doble clic manda una sola petición", async () => {
    const { api, client } = setup({
      getConversation: historyThen(afterOption("Agendar una cita")),
    });
    await client.load();
    const [first, second] = await Promise.all([client.send(AGENDAR), client.send(AGENDAR)]);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(client.view().messages).toHaveLength(3);
  });

  it("restart borra la sesión y vuelve a cargar", async () => {
    const { api, session, client } = setup();
    await client.load();
    await client.restart();
    expect(session.clear).toHaveBeenCalledTimes(1);
    expect(api.getConversation).toHaveBeenCalledTimes(2);
  });
});
