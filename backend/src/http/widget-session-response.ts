import { getContainer } from "@/composition-root";
import type { Actor } from "@/modules/auth/domain/actor";
import { forbidden } from "@/modules/auth/domain/auth-error";
import type { ClientToken } from "@/modules/auth/domain/ports/client-token-source";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { StartedWidgetSession } from "@/modules/widget/application/widget-sessions";
import type { WidgetAccess } from "@/modules/widget/domain/ports/ports";
import {
  sessionIdOfSubject,
  sessionSubject,
  type WidgetSession,
} from "@/modules/widget/domain/widget-session";
import { clientIp } from "./client-ip";
import type { IdempotentOutcome, IdempotentResult } from "./idempotency-core";

/** Cabecera con el secreto propio de la conversacion (spec 5 §6.1). */
export const CONVERSATION_SECRET_HEADER = "X-Conversation-Secret";

const UNREACHABLE = "Conversacion vencida o inexistente";

function tokenJson(token: ClientToken, session: WidgetSession) {
  return {
    access_token: token.accessToken,
    expires_at: token.expiresAt.toISOString(),
    session_expires_at: session.expiresAt.toISOString(),
  };
}

/**
 * Apertura: el cuerpo lleva el secreto en claro; lo persistido en `idempotency_keys` es
 * `{ session_id, sealed_secret }`, con el secreto sellado por SecretBox (decision 1 del plan).
 */
export function openedSessionOutcome(
  started: StartedWidgetSession,
  token: ClientToken,
): IdempotentOutcome {
  return {
    status: 201,
    body: { ...tokenJson(token, started.session), conversation_secret: started.conversationSecret },
    stored: {
      session_id: started.session.id,
      sealed_secret: getContainer().conversationSecretBox.seal(started.conversationSecret),
    },
  };
}

export function refreshedSessionOutcome(
  session: WidgetSession,
  token: ClientToken,
): IdempotentOutcome {
  return { status: 200, body: tokenJson(token, session), stored: { session_id: session.id } };
}

function storedString(stored: IdempotentResult, field: string): string | null {
  const body = stored.body;
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function reusedKey(): ConflictError {
  return new ConflictError("Idempotency-Key reutilizada con otra peticion");
}

/**
 * Repeticion de la apertura: abre el secreto sellado y lo devuelve con el token recien
 * obtenido. Lo guardado antes del corte (sin `sealed_secret`) no se puede rehacer: `409`.
 */
export async function rebuildOpenedSession(
  stored: IdempotentResult,
  tenantId: TenantId,
  token: ClientToken,
): Promise<IdempotentResult> {
  const sessionId = storedString(stored, "session_id");
  const sealed = storedString(stored, "sealed_secret");
  if (sessionId === null || sealed === null) {
    throw reusedKey();
  }
  const container = getContainer();
  const session = await container.getActiveWidgetSession(tenantId, sessionId);
  return {
    status: stored.status,
    body: {
      ...tokenJson(token, session),
      conversation_secret: container.conversationSecretBox.open(sealed),
    },
  };
}

/** Repeticion de la renovacion: la clave de otra conversacion es un conflicto, nunca su token. */
export async function rebuildRefreshedSession(
  stored: IdempotentResult,
  tenantId: TenantId,
  expectedSessionId: string,
  token: ClientToken,
): Promise<IdempotentResult> {
  if (storedString(stored, "session_id") !== expectedSessionId) {
    throw reusedKey();
  }
  const session = await getContainer().getActiveWidgetSession(tenantId, expectedSessionId);
  return { status: stored.status, body: tokenJson(token, session) };
}

/** El navegador debe hablar desde el mismo origen que abrio la sesion. */
export function assertSessionOrigin(request: Request, session: { readonly origin: string }): void {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin.toLowerCase() !== session.origin.toLowerCase()) {
    throw forbidden("Origen distinto al de la sesion");
  }
}

/** Sin la cabecera la conversacion es inalcanzable: `404`, como cualquier fallo de conversacion. */
export function conversationSecretOf(request: Request): string {
  const secret = request.headers.get(CONVERSATION_SECRET_HEADER)?.trim() ?? "";
  if (secret === "") {
    throw new NotFoundError(UNREACHABLE);
  }
  return secret;
}

/**
 * Resuelve la conversacion del widget por su secreto, dentro del tenant del token, y comprueba
 * el origen. El actor devuelto lleva `widget:<sessionId>` como sujeto (decision 2 del plan).
 */
export async function resolveWidgetConversation(
  actor: Actor,
  request: Request,
): Promise<{ session: WidgetSession; actor: Actor }> {
  const secret = conversationSecretOf(request);
  const session = await getContainer().findWidgetSessionBySecret(actor.tenantId, secret);
  assertSessionOrigin(request, session);
  return { session, actor: { ...actor, subject: sessionSubject(session.id) } };
}

/** Sesion del actor ya resuelto por `resolveWidgetConversation`. */
export function conversationSessionId(actor: Actor): string {
  const sessionId = sessionIdOfSubject(actor.subject);
  if (sessionId === null) {
    throw new NotFoundError(UNREACHABLE);
  }
  return sessionId;
}

function widgetKeyOf(body: unknown): unknown {
  return typeof body === "object" && body !== null
    ? (body as { widget_key?: unknown }).widget_key
    : undefined;
}

/** Clave publica, Origin permitido y rate limit por IP: comun a apertura y renovacion. */
export function admitWidgetRequest(request: Request, body: unknown): Promise<WidgetAccess> {
  const container = getContainer();
  const origin = request.headers.get("Origin");
  return container.admitWidget({
    widgetKey: widgetKeyOf(body),
    origin: origin === "" ? null : origin,
    clientIp: clientIp(request, container.config.trustProxy),
  });
}
