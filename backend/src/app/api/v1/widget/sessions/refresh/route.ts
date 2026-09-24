import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { rebuildSessionResponse, sessionTokenJson } from "@/http/widget-session-response";
import type { Actor } from "@/modules/auth/domain/actor";
import { unauthorized } from "@/modules/auth/domain/auth-error";

export const dynamic = "force-dynamic";

function sessionIdOf(actor: Actor): string {
  if (!actor.sessionId) {
    throw unauthorized();
  }
  return actor.sessionId;
}

/** El widget renueva solo la sesion de su propio token. */
export const POST = idempotentRoute(
  ["widget"],
  async ({ actor, ports }) => {
    const session = await ports.refreshWidgetSession({
      tenantId: actor.tenantId,
      sessionId: sessionIdOf(actor),
    });
    const issued = await getContainer().issueSessionToken(session);
    return {
      status: 200,
      body: sessionTokenJson(session, issued),
      stored: { session_id: session.id },
    };
  },
  {
    rebuild: (stored, actor) => rebuildSessionResponse(stored, actor.tenantId, sessionIdOf(actor)),
  },
);
