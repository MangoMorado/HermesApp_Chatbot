import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  ConversationSecrets,
  WidgetAccess,
  WidgetSessionRepository,
  WidgetSettingsReader,
} from "../domain/ports/ports";
import { isSessionActive, sessionExpiry, type WidgetSession } from "../domain/widget-session";

export type StartedWidgetSession = {
  readonly session: WidgetSession;
  /** En claro solo en esta respuesta: en base queda su hash. */
  readonly conversationSecret: string;
};

export function createStartWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  secrets: ConversationSecrets;
  ids: IdGenerator;
  clock: Clock;
}) {
  return async (input: { access: WidgetAccess; origin: string }): Promise<StartedWidgetSession> => {
    const now = deps.clock.now();
    const conversationSecret = deps.secrets.generate();
    const session: WidgetSession = {
      id: deps.ids.next(),
      tenantId: input.access.tenantId,
      origin: input.origin.toLowerCase(),
      createdAt: now,
      expiresAt: sessionExpiry(now, input.access.sessionTtlMinutes),
      lastSeenAt: now,
      secretHash: deps.secrets.hash(conversationSecret),
    };
    await deps.sessions.create(session);
    return { session, conversationSecret };
  };
}

function activeOrNotFound(session: WidgetSession | null, now: Date): WidgetSession {
  if (!session || !isSessionActive(session, now)) {
    throw new NotFoundError("Conversacion vencida o inexistente");
  }
  return session;
}

/** La vigencia se evalua al leer: una sesion vencida o ajena es `not_found`. */
export function createGetActiveWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  clock: Clock;
}) {
  return async (tenantId: TenantId, sessionId: string): Promise<WidgetSession> =>
    activeOrNotFound(await deps.sessions.get(tenantId, sessionId), deps.clock.now());
}

/**
 * Resuelve la conversacion por su secreto, solo dentro del tenant del token o de la clave:
 * un secreto de otra clinica, desconocido o de una sesion vencida es `not_found`.
 */
export function createFindWidgetSessionBySecret(deps: {
  sessions: WidgetSessionRepository;
  secrets: ConversationSecrets;
  clock: Clock;
}) {
  return async (tenantId: TenantId, secret: string): Promise<WidgetSession> => {
    if (secret === "") {
      throw new NotFoundError("Conversacion vencida o inexistente");
    }
    const session = await deps.sessions.getBySecretHash(tenantId, deps.secrets.hash(secret));
    return activeOrNotFound(session, deps.clock.now());
  };
}

export function createRefreshWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  settings: WidgetSettingsReader;
  clock: Clock;
}) {
  const getActive = createGetActiveWidgetSession(deps);
  return async (input: { tenantId: TenantId; sessionId: string }): Promise<WidgetSession> => {
    const session = await getActive(input.tenantId, input.sessionId);
    const now = deps.clock.now();
    const { sessionTtlMinutes } = await deps.settings(input.tenantId);
    const refreshed = {
      ...session,
      lastSeenAt: now,
      expiresAt: sessionExpiry(now, sessionTtlMinutes),
    };
    await deps.sessions.extend(refreshed);
    return refreshed;
  };
}
