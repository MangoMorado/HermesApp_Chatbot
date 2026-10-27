import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationHistory,
  ConversationTurn,
  WidgetSession,
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

const SESSION: WidgetSession = {
  session_id: "s1",
  token: "tok",
  expires_at: "2026-10-13T16:00:00.000Z",
};

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
  refreshWidgetSession.mockReset().mockResolvedValue(SESSION);
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

  it("refreshSession lleva token e Idempotency-Key", async () => {
    await expect(api().refreshSession("t1", "idem-refresh")).resolves.toEqual(SESSION);
    expect(refreshWidgetSession).toHaveBeenCalledWith({
      apiBase: "https://api.test",
      token: "t1",
      headers: { "Idempotency-Key": "idem-refresh" },
    });
  });

  it("getConversation solo lleva token", async () => {
    await expect(api().getConversation("t1")).resolves.toEqual(HISTORY);
    expect(getWidgetConversation).toHaveBeenCalledWith({
      apiBase: "https://api.test",
      token: "t1",
    });
  });

  it("sendMessage lleva input, token e Idempotency-Key", async () => {
    const input = { text: "hola" };
    await expect(api().sendMessage("t1", input, "idem-send")).resolves.toEqual(TURN);
    expect(sendWidgetMessage).toHaveBeenCalledWith(input, {
      apiBase: "https://api.test",
      token: "t1",
      headers: { "Idempotency-Key": "idem-send" },
    });
  });
});
