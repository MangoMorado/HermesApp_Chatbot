import type { TenantId } from "@/modules/shared/domain/tenant-id";

/** Sesion del widget. No guarda la IP: esa solo vive en memoria para el rate limit. */
export type WidgetSession = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly origin: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  /**
   * Hash (sha256 hex) del `conversation_secret`; el secreto en claro solo lo tiene el widget.
   * `null` en sesiones anteriores al corte de identidad: quedan inalcanzables y vencen solas.
   */
  readonly secretHash: string | null;
};

/** Actor de la apertura anonima en `idempotency_keys`. */
export const ANONYMOUS_WIDGET_SUBJECT = "widget:anonymous";

/**
 * En la apertura anonima, la Idempotency-Key hace de secreto del cliente: quien la conozca
 * junto con la clave publica obtendria un token de esa sesion al repetir la peticion.
 */
export const MIN_ANONYMOUS_IDEMPOTENCY_KEY_LENGTH = 32;

export function isSessionActive(session: Pick<WidgetSession, "expiresAt">, now: Date): boolean {
  return now.getTime() < session.expiresAt.getTime();
}

export function sessionExpiry(now: Date, ttlMinutes: number): Date {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

/** Comparacion exacta en minusculas; sin origen o con lista vacia no se admite nada. */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  return origin !== null && allowed.includes(origin.toLowerCase());
}

const SUBJECT_PREFIX = "widget:";

/**
 * Sujeto de auditoria e idempotencia de una conversacion. El `sub` del token es el mismo para
 * todas las conversaciones de la clinica, asi que las rutas del widget lo sustituyen por este.
 */
export function sessionSubject(sessionId: string): string {
  return `${SUBJECT_PREFIX}${sessionId}`;
}

/** Inversa de `sessionSubject`; `null` si el sujeto no es de una conversacion. */
export function sessionIdOfSubject(subject: string): string | null {
  if (!subject.startsWith(SUBJECT_PREFIX)) {
    return null;
  }
  const sessionId = subject.slice(SUBJECT_PREFIX.length);
  return sessionId === "" ? null : sessionId;
}
