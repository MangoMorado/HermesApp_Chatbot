import { getContainer } from "@/composition-root";
import { assertSessionOrigin, withWidgetCors } from "@/http/cors";
import { idempotentRoute } from "@/http/idempotent-route";
import {
  rebuildSessionResponse,
  sessionIdOf,
  sessionTokenJson,
} from "@/http/widget-session-response";

export const dynamic = "force-dynamic";

/** El widget renueva solo la sesion de su propio token. */
const refresh = idempotentRoute(
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
    guard: async ({ actor, request }) =>
      assertSessionOrigin(
        request,
        await getContainer().getActiveWidgetSession(actor.tenantId, sessionIdOf(actor)),
      ),
    rebuild: (stored, actor) => rebuildSessionResponse(stored, actor.tenantId, sessionIdOf(actor)),
  },
);

export const POST = withWidgetCors(refresh);
export { widgetPreflight as OPTIONS } from "@/http/cors";
