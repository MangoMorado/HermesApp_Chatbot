import { getContainer } from "@/composition-root";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import { privateRoute } from "@/http/route";
import { pageJson } from "@/http/serializers";
import { inboxRequestJson } from "@/http/serializers-sim-inbox";
import { parseLimit } from "@/modules/shared/domain/pagination";

export const dynamic = "force-dynamic";

/** Bandeja de Hermes: solicitudes pendientes y vivas del tenant del token. */
export const GET = privateRoute(["admin"], async ({ actor, request }) => {
  requireSimulatorEnabled();
  const url = new URL(request.url);
  const page = await getContainer().listInbox({
    tenantId: actor.tenantId,
    cursor: url.searchParams.get("cursor"),
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return pageJson(page, inboxRequestJson);
});
