import { randomUUID } from "node:crypto";
import { signLogoutToken } from "../../helpers/idp";
import { CHAT_ORIGIN } from "../chat-support";
import { call } from "./invoke";
import { casesFor, type OpSpec } from "./spec";
import type { ContractCase } from "./types";
import type { ContractWorld } from "./world";

/** Operaciones publicas, de identidad y del widget de /api/v1. */

const widget = (w: ContractWorld) => w.widgetA.token;
const admin = (w: ContractWorld) => w.tokens.adminA;

function custom(
  method: OpSpec["method"],
  template: string,
  status: number,
  name: string,
  run: ContractCase["run"],
): ContractCase {
  return { surface: "chatbot", method, path: template, status, name, run };
}

function openSession(widgetKey: string, headers: Record<string, string> = {}) {
  return call({
    surface: "chatbot",
    method: "post",
    template: "/widget/sessions",
    path: "/widget/sessions",
    headers: { Origin: CHAT_ORIGIN, "Idempotency-Key": randomUUID(), ...headers },
    body: { widget_key: widgetKey },
  });
}

function refresh(widgetKey: string, secret: string, headers: Record<string, string> = {}) {
  return call({
    surface: "chatbot",
    method: "post",
    template: "/widget/sessions/refresh",
    path: "/widget/sessions/refresh",
    headers: {
      Origin: CHAT_ORIGIN,
      "Idempotency-Key": randomUUID(),
      "X-Conversation-Secret": secret,
      ...headers,
    },
    body: { widget_key: widgetKey },
  });
}

const IDENTITY: OpSpec[] = [
  {
    surface: "chatbot",
    method: "get",
    template: "/health",
    public: true,
    token: () => null,
    ok: () => ({ path: "/health" }),
  },
  {
    surface: "chatbot",
    method: "get",
    template: "/me",
    token: admin,
    // `platform` no pertenece a ninguna clinica: /api/v1 no lo admite.
    forbiddenToken: (w) => w.tokens.platform,
    ok: () => ({ path: "/me" }),
  },
  {
    surface: "chatbot",
    method: "post",
    template: "/auth/backchannel-logout",
    public: true,
    token: () => null,
    ok: async () => ({
      path: "/auth/backchannel-logout",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      rawBody: `logout_token=${await signLogoutToken({ sid: `sid-${randomUUID()}` })}`,
    }),
    extra: [
      custom("post", "/auth/backchannel-logout", 400, "sin logout_token", () =>
        call({
          surface: "chatbot",
          method: "post",
          template: "/auth/backchannel-logout",
          path: "/auth/backchannel-logout",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          rawBody: "",
        }),
      ),
    ],
  },
];

const SESSIONS: OpSpec[] = [
  {
    surface: "chatbot",
    method: "post",
    template: "/widget/sessions",
    public: true,
    write: true,
    okStatus: 201,
    token: () => null,
    ok: (w) => ({
      path: "/widget/sessions",
      headers: { Origin: CHAT_ORIGIN },
      body: { widget_key: w.tenantA.widgetKey },
    }),
    invalid: (w) => ({
      path: "/widget/sessions",
      headers: { Origin: CHAT_ORIGIN, "Idempotency-Key": "corta" },
      body: { widget_key: w.tenantA.widgetKey },
    }),
    extra: [
      custom("post", "/widget/sessions", 401, "clave de widget invalida", () =>
        openSession("wk_inexistente"),
      ),
      custom("post", "/widget/sessions", 403, "origen no permitido", (w) =>
        openSession(w.tenantA.widgetKey, { Origin: "https://otro.test" }),
      ),
      custom("post", "/widget/sessions", 429, "limite por IP", async (w) => {
        await openSession(w.limitedWidgetKey);
        return openSession(w.limitedWidgetKey);
      }),
    ],
  },
  {
    surface: "chatbot",
    method: "post",
    template: "/widget/sessions/refresh",
    public: true,
    write: true,
    token: () => null,
    ok: (w) => ({
      path: "/widget/sessions/refresh",
      headers: { Origin: CHAT_ORIGIN, "X-Conversation-Secret": w.widgetA.secret },
      body: { widget_key: w.tenantA.widgetKey },
    }),
    extra: [
      custom("post", "/widget/sessions/refresh", 401, "clave de widget invalida", (w) =>
        refresh("wk_inexistente", w.widgetA.secret),
      ),
      custom("post", "/widget/sessions/refresh", 403, "origen no permitido", (w) =>
        refresh(w.tenantA.widgetKey, w.widgetA.secret, { Origin: "https://otro.test" }),
      ),
      custom("post", "/widget/sessions/refresh", 404, "secreto de otra conversacion", (w) =>
        refresh(w.tenantA.widgetKey, "secreto-ajeno"),
      ),
      custom("post", "/widget/sessions/refresh", 429, "limite por IP", async (w) => {
        await openSession(w.limitedWidgetKey);
        return refresh(w.limitedWidgetKey, "cualquiera");
      }),
    ],
  },
];

const CONVERSATION: OpSpec[] = [
  {
    surface: "chatbot",
    method: "get",
    template: "/widget/conversation",
    token: widget,
    forbiddenToken: admin,
    ok: (w) => ({
      path: "/widget/conversation",
      headers: { "X-Conversation-Secret": w.widgetA.secret },
    }),
    notFound: () => ({
      path: "/widget/conversation",
      headers: { "X-Conversation-Secret": "secreto-ajeno" },
    }),
  },
  {
    surface: "chatbot",
    method: "post",
    template: "/widget/conversation/messages",
    token: widget,
    forbiddenToken: admin,
    write: true,
    ok: (w) => ({
      path: "/widget/conversation/messages",
      headers: { "X-Conversation-Secret": w.widgetA.secret },
      body: { text: "hola" },
    }),
    notFound: () => ({
      path: "/widget/conversation/messages",
      headers: { "X-Conversation-Secret": "secreto-ajeno" },
      body: { text: "hola" },
    }),
    invalid: (w) => ({
      path: "/widget/conversation/messages",
      headers: { "X-Conversation-Secret": w.widgetA.secret },
      body: { text: "hola", option_id: "x" },
    }),
  },
];

export const CHATBOT_WIDGET_CASES: readonly ContractCase[] = [
  ...IDENTITY,
  ...SESSIONS,
  ...CONVERSATION,
].flatMap(casesFor);
