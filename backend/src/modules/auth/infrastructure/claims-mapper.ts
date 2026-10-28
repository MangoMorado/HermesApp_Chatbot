import type { AppConfig } from "@/config/env";
import type { TokenClaims } from "../domain/ports/token-verifier";
import { isRole, type Role } from "../domain/role";

type MapperSettings = Pick<AppConfig["oidc"], "tenantClaim" | "rolesClaim" | "roleMap">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(payload: Record<string, unknown>, segments: readonly string[]): unknown {
  let current: unknown = payload;
  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickTenant(value: unknown, pick: MapperSettings["tenantClaim"]["pick"]): string {
  let tenant: string | undefined;
  if (pick === "value") {
    tenant = nonEmptyString(value);
  } else if (pick === "single-element") {
    tenant = Array.isArray(value) && value.length === 1 ? nonEmptyString(value[0]) : undefined;
  } else if (isRecord(value)) {
    const keys = Object.keys(value);
    tenant = keys.length === 1 ? nonEmptyString(keys[0]) : undefined;
  }
  if (!tenant) {
    throw new Error("El claim de tenant no es valido");
  }
  return tenant;
}

function resolveRole(payload: Record<string, unknown>, settings: MapperSettings): Role {
  const raw = walk(payload, settings.rolesClaim);
  const external = Array.isArray(raw) ? raw : [];
  const roles = new Set<Role>();
  for (const item of external) {
    if (typeof item !== "string") {
      continue;
    }
    const mapped = settings.roleMap.get(item) ?? item;
    if (isRole(mapped)) {
      roles.add(mapped);
    }
  }
  const [role, ...others] = [...roles];
  if (!role || others.length > 0) {
    throw new Error("El token debe traer exactamente un rol del producto");
  }
  return role;
}

/** Traduce el payload de un token del proveedor a los claims del nucleo. Lanza si es invalido. */
export function mapClaims(payload: Record<string, unknown>, settings: MapperSettings): TokenClaims {
  const subject = nonEmptyString(payload.sub);
  if (!subject) {
    throw new Error("El token no trae sub");
  }
  const role = resolveRole(payload, settings);
  const sid = nonEmptyString(payload.sid);
  const session = sid ? { providerSessionId: sid } : {};
  if (role === "platform") {
    return { subject, role, tenantId: null, ...session };
  }
  const tenantId = pickTenant(
    walk(payload, settings.tenantClaim.segments),
    settings.tenantClaim.pick,
  );
  return { subject, role, tenantId, ...session };
}
