import { unauthorized } from "@/modules/auth/domain/auth-error";
import type { TokenIssuer } from "@/modules/auth/domain/ports/token-issuer";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  WidgetAccess,
  WidgetSessionRepository,
  WidgetSettingsReader,
} from "../domain/ports/ports";
import {
  isSessionActive,
  sessionExpiry,
  sessionSubject,
  type WidgetSession,
} from "../domain/widget-session";

export function createStartWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  ids: IdGenerator;
  clock: Clock;
}) {
  return async (input: { access: WidgetAccess; origin: string }): Promise<WidgetSession> => {
    const now = deps.clock.now();
    const session: WidgetSession = {
      id: deps.ids.next(),
      tenantId: input.access.tenantId,
      origin: input.origin.toLowerCase(),
      createdAt: now,
      expiresAt: sessionExpiry(now, input.access.sessionTtlMinutes),
      lastSeenAt: now,
    };
    await deps.sessions.create(session);
    return session;
  };
}

/** La vigencia se evalua al leer: una sesion vencida es `unauthorized`. */
export function createGetActiveWidgetSession(deps: {
  sessions: WidgetSessionRepository;
  clock: Clock;
}) {
  return async (tenantId: TenantId, sessionId: string): Promise<WidgetSession> => {
    const session = await deps.sessions.get(tenantId, sessionId);
    if (!session || !isSessionActive(session, deps.clock.now())) {
      throw unauthorized("Sesion vencida o inexistente");
    }
    return session;
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

export type SessionToken = { readonly token: string; readonly expiresAt: Date };

/** El token del widget expira con la sesion y lleva su `session_id`. */
export function createIssueSessionToken(deps: { issuer: TokenIssuer; clock: Clock }) {
  return async (session: WidgetSession): Promise<SessionToken> => ({
    token: await deps.issuer.issue({
      subject: sessionSubject(session.id),
      tenantId: session.tenantId,
      role: "widget",
      sessionId: session.id,
      issuedAt: deps.clock.now(),
      expiresAt: session.expiresAt,
    }),
    expiresAt: session.expiresAt,
  });
}
