import { getContainer } from "@/composition-root";
import type { Actor } from "@/modules/auth/domain/actor";
import { unauthorized } from "@/modules/auth/domain/auth-error";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { SessionToken } from "@/modules/widget/application/widget-sessions";
import type { WidgetSession } from "@/modules/widget/domain/widget-session";
import type { IdempotentResult } from "./idempotency-core";

export function sessionTokenJson(session: WidgetSession, issued: SessionToken) {
  return {
    session_id: session.id,
    token: issued.token,
    expires_at: issued.expiresAt.toISOString(),
  };
}

function storedSessionId(stored: IdempotentResult): string | null {
  const body = stored.body;
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const sessionId = (body as { session_id?: unknown }).session_id;
  return typeof sessionId === "string" ? sessionId : null;
}

/**
 * Repeticion idempotente de apertura o renovacion: lo guardado es `{ session_id }` y el
 * token se vuelve a firmar si la sesion sigue vigente. Si se espera una sesion concreta
 * (renovacion), la clave de otra sesion es un conflicto y no entrega su token.
 */
export async function rebuildSessionResponse(
  stored: IdempotentResult,
  tenantId: TenantId,
  expectedSessionId?: string,
): Promise<IdempotentResult> {
  const sessionId = storedSessionId(stored);
  if (sessionId === null) {
    return stored;
  }
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion");
  }
  const container = getContainer();
  const session = await container.getActiveWidgetSession(tenantId, sessionId);
  return {
    status: stored.status,
    body: sessionTokenJson(session, await container.issueSessionToken(session)),
  };
}

/** Sesion del token de widget; sin ella el token no sirve para el chat. */
export function sessionIdOf(actor: Actor): string {
  if (!actor.sessionId) {
    throw unauthorized();
  }
  return actor.sessionId;
}
