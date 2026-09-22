import { idempotentRoute } from "@/http/idempotent-route";
import { requireSimulatorEnabled } from "@/http/require-simulator";
import type { WeekdayWindow } from "@/modules/hermes-simulator/domain/entities";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Genera cupos en el simulador.
 * En el contrato OpenAPI se declara como `slots:generate`; en disco es
 * `slots/generate` porque Windows no admite `:` en nombres de carpeta.
 */
export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  idempotentRoute(["admin"], async ({ actor, requestId, body, ports }) => {
    requireSimulatorEnabled();
    const { id } = await context.params;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("Cuerpo invalido");
    }
    const data = body as Record<string, unknown>;
    const from = data.from;
    const to = data.to;
    const durationMinutes = data.duration_minutes;
    const windowsRaw = data.windows;
    if (typeof from !== "string" || typeof to !== "string") {
      throw new ValidationError("from y to son obligatorios", { fields: ["from", "to"] });
    }
    if (typeof durationMinutes !== "number") {
      throw new ValidationError("duration_minutes es obligatorio", { field: "duration_minutes" });
    }
    if (!Array.isArray(windowsRaw)) {
      throw new ValidationError("windows es obligatorio", { field: "windows" });
    }
    const windows: WeekdayWindow[] = windowsRaw.map((item) => {
      if (!item || typeof item !== "object") {
        throw new ValidationError("windows invalido", { field: "windows" });
      }
      const window = item as Record<string, unknown>;
      return {
        weekday: Number(window.weekday),
        startTime: String(window.start_time ?? ""),
        endTime: String(window.end_time ?? ""),
      };
    });
    const result = await ports.generateSimSlots({
      tenantId: actor.tenantId,
      tenantIdTyped: actor.tenantId,
      scheduleId: id,
      from,
      to,
      durationMinutes,
      windows,
      timeZone: ports.appTimezone,
      actorSubject: actor.subject,
      actorRole: actor.role,
      requestId,
    });
    return { status: 200, body: { created: result.created } };
  })(request);
