import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationHistory,
  ConversationTurn,
  WidgetSessionOpened,
  WidgetSessionRefreshed,
} from "@/widget/api/models";
import { createWidgetApi } from "@/widget/widget-api";

const openWidgetSession = vi.fn();
const refreshWidgetSession = vi.fn();
const getWidgetConversation = vi.fn();
const sendWidgetMessage = vi.fn();

vi.mock("@/widget/api/endpoints", () => ({
  openWidgetSession: (...args: unknown[]) => openWidgetSession(...args),
  refreshWidgetSession: (...args: unknown[]) => refreshWidgetSession(...args),
  getWidgetConversation: (...args: unknown[]) => getWidgetConversation(...args),
  sendWidgetMessage: (...args: unknown[]) => sendWidgetMessage(...args),
}));

const REFRESHED: WidgetSessionRefreshed = {
  access_token: "tok",
  expires_at: "2026-10-13T16:00:00.000Z",
  expires_in: 300,
  session_expires_at: "2026-10-13T16:30:00.000Z",
};

const SESSION: WidgetSessionOpened = { ...REFRESHED, conversation_secret: "cs" };

const CREDENTIALS = { accessToken: "t1", conversationSecret: "cs" };

const HISTORY: ConversationHistory = {
  messages: [],
  options: [],
  input: "none",
};

const TURN: ConversationTurn = {
  messages: ["ok"],
  options: [],
  input: "text",
};

beforeEach(() => {
  openWidgetSession.mockReset().mockResolvedValue(SESSION);
  refreshWidgetSession.mockReset().mockResolvedValue(REFRESHED);
  getWidgetConversation.mockReset().mockResolvedValue(HISTORY);
  sendWidgetMessage.mockReset().mockResolvedValue(TURN);
});

describe("createWidgetApi", () => {
  const api = () => createWidgetApi({ apiBase: "https://api.test", widgetKey: "wk_demo" });

  it("openSession manda la clave del widget y la Idempotency-Key", async () => {
    await expect(api().openSession("idem-open")).resolves.toEqual(SESSION);
    expect(openWidgetSession).toHaveBeenCalledWith(
      { widget_key: "wk_demo" },
      { apiBase: "https://api.test", headers: { "Idempotency-Key": "idem-open" } },
    );
  });

  it("refreshSession va sin bearer, con clave, secreto e Idempotency-Key", async () => {
    await expect(api().refreshSession("cs", "idem-refresh")).resolves.toEqual(REFRESHED);
    expect(refreshWidgetSession).toHaveBeenCalledWith(
      { widget_key: "wk_demo" },
      {
        apiBase: "https://api.test",
        headers: { "Idempotency-Key": "idem-refresh", "X-Conversation-Secret": "cs" },
      },
    );
  });

  it("getConversation lleva token y secreto de la conversacion", async () => {
    await expect(api().getConversation(CREDENTIALS)).resolves.toEqual(HISTORY);
    expect(getWidgetConversation).toHaveBeenCalledWith({
      apiBase: "https://api.test",
      token: "t1",
      headers: { "X-Conversation-Secret": "cs" },
    });
  });

  it("sendMessage lleva input, token, secreto e Idempotency-Key", async () => {
    const input = { text: "hola" };
    await expect(api().sendMessage(CREDENTIALS, input, "idem-send")).resolves.toEqual(TURN);
    expect(sendWidgetMessage).toHaveBeenCalledWith(input, {
      apiBase: "https://api.test",
      token: "t1",
      headers: { "Idempotency-Key": "idem-send", "X-Conversation-Secret": "cs" },
    });
  });
});
