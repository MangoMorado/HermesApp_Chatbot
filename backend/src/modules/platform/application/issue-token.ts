import type { TokenIssuer } from "@/modules/auth/domain/ports/token-issuer";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import type { AuditLog } from "@/modules/shared/domain/ports/audit-log";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { PLATFORM_AUDIT_ACTOR } from "../domain/platform-actor";
import type { TenantRegistry } from "../domain/ports/tenant-registry";
import { parseTokenRequest } from "../domain/token-request";

export type IssuedToken = { readonly token: string; readonly expiresAt: Date };
export type IssueToken = (input: { raw: unknown; requestId: string }) => Promise<IssuedToken>;

type Deps = {
  readonly registry: TenantRegistry;
  readonly issuer: TokenIssuer;
  readonly audit: AuditLog;
  readonly clock: Clock;
};

/** Firmar un JWT no escribe dominio: sin Idempotency-Key. Se audita el hecho, nunca el token. */
export function createIssueToken(deps: Deps): IssueToken {
  return async ({ raw, requestId }) => {
    const request = parseTokenRequest(raw);
    if (!(await deps.registry.exists(request.tenantId))) {
      throw new NotFoundError("Tenant inexistente");
    }
    const issuedAt = deps.clock.now();
    const expiresAt = new Date(issuedAt.getTime() + request.ttlMinutes * 60_000);
    const token = await deps.issuer.issue({
      subject: request.subject,
      tenantId: request.tenantId,
      role: request.role,
      issuedAt,
      expiresAt,
    });
    await deps.audit.record({
      tenantId: toTenantId(request.tenantId),
      ...PLATFORM_AUDIT_ACTOR,
      action: "token.issued",
      resourceType: `token.${request.role}`,
      resourceId: request.subject,
      requestId,
      occurredAt: issuedAt,
    });
    return { token, expiresAt };
  };
}
