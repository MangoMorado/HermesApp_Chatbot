import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { POST as postMessage } from "@/app/api/v1/widget/conversation/messages/route";
import { GET as getConversation } from "@/app/api/v1/widget/conversation/route";
import { POST as openSession } from "@/app/api/v1/widget/sessions/route";
import { authedRequest } from "../helpers/idp";
import { insertWidgetCredential } from "./support";

export const CHAT_ORIGIN = "https://clinica-chat.test";
const BASE = "http://localhost/api/v1/widget";

/** Respuesta de POST /conversation/messages: mensajes como texto. */
export type ChatBody = {
  messages: string[];
  options: { id: string; label: string }[];
  input: string;
};

/** Respuesta de GET /conversation: historial con metadatos por mensaje. */
export type HistoryBody = {
  messages: { author: string; text: string; redacted: boolean; created_at: string }[];
  options: { id: string; label: string }[];
  input: string;
};

/** Credenciales de una conversacion del widget: token del proveedor y secreto propio. */
export type WidgetChat = { readonly token: string; readonly secret: string };

/** Da de alta el widget sobre un tenant ya sembrado (seedWorld no crea bot-config). */
export async function enableWidget(
  prisma: PrismaClient,
  tenantId: string,
  slug: string,
): Promise<string> {
  const widgetKey = `wk_${slug.repeat(43).slice(0, 43)}`;
  await prisma.botConfig.create({ data: { tenantId, allowedOrigins: [CHAT_ORIGIN] } });
  await prisma.widgetKey.create({
    data: { id: `${tenantId}-key`, tenantId, key: widgetKey, createdAt: new Date() },
  });
  await insertWidgetCredential(prisma, tenantId);
  return widgetKey;
}

export async function openChat(widgetKey: string): Promise<WidgetChat> {
  const response = await openSession(
    new Request(`${BASE}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: CHAT_ORIGIN,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ widget_key: widgetKey }),
    }),
  );
  const body = await response.json();
  return { token: body.access_token, secret: body.conversation_secret };
}

function chatHeaders(chat: WidgetChat, headers: Record<string, string>): Record<string, string> {
  return { "X-Conversation-Secret": chat.secret, ...headers };
}

export function getChat(chat: WidgetChat, headers: Record<string, string> = {}) {
  return getConversation(
    authedRequest(`${BASE}/conversation`, chat.token, { headers: chatHeaders(chat, headers) }),
  );
}

export function sendChat(
  chat: WidgetChat,
  message: { option_id: string } | { text: string },
  key: string = randomUUID(),
  headers: Record<string, string> = {},
) {
  return postMessage(
    authedRequest(`${BASE}/conversation/messages`, chat.token, {
      method: "POST",
      headers: chatHeaders(chat, {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...headers,
      }),
      body: JSON.stringify(message),
    }),
  );
}

export function optionId(body: ChatBody, label: string): string {
  const option = body.options.find((o) => o.label === label);
  if (!option) {
    throw new Error(`Sin opcion «${label}»: ${body.options.map((o) => o.label).join(" | ")}`);
  }
  return option.id;
}
