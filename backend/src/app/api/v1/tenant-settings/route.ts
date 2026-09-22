import { getContainer } from "@/composition-root";
import { idempotentRoute } from "@/http/idempotent-route";
import { privateRoute } from "@/http/route";
import { tenantSettingsJson } from "@/http/serializers";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

export const GET = privateRoute(["operator", "admin"], async ({ actor }) => {
  const settings = await getContainer().getTenantSettings(actor.tenantId);
  return tenantSettingsJson(settings);
});

export const PATCH = idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Cuerpo invalido");
  }
  const raw = (body as { max_query_range_days?: unknown }).max_query_range_days;
  if (typeof raw !== "number") {
    throw new ValidationError("max_query_range_days es obligatorio", {
      field: "max_query_range_days",
    });
  }
  const settings = await ports.updateTenantSettings({
    tenantId: actor.tenantId,
    maxQueryRangeDays: raw,
    actorSubject: actor.subject,
    actorRole: actor.role,
    requestId,
  });
  return { status: 200, body: tenantSettingsJson(settings) };
});
