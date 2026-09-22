import { describe, expect, it } from "vitest";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { GET as getPractitioners } from "@/app/api/v1/practitioners/route";
import { requireRole, requireSession, requireTenant } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { authorized, signToken } from "./helpers/token";

const operator: Actor = {
  subject: "u-1",
  tenantId: toTenantId("tenant-a"),
  role: "operator",
};
const widget: Actor = {
  subject: "s-1",
  tenantId: toTenantId("tenant-a"),
  role: "widget",
  sessionId: "chat-1",
};

describe("roles: autorizacion en el nucleo", () => {
  it("admite el rol declarado por la ruta", () => {
    expect(() => requireRole(operator, ["operator", "admin"])).not.toThrow();
  });

  it("rechaza con forbidden un rol fuera de la lista", () => {
    expect(() => requireRole(widget, ["operator", "admin"])).toThrowError(
      expect.objectContaining({ reason: "forbidden" }),
    );
  });

  it("un recurso de otro tenant es not_found, nunca forbidden", () => {
    try {
      requireTenant(operator, "tenant-b");
      expect.unreachable("deberia haber fallado");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).reason).toBe("not_found");
    }
  });

  it("el widget no alcanza una sesion ajena", () => {
    expect(() => requireSession(widget, "chat-1")).not.toThrow();
    expect(() => requireSession(widget, "chat-2")).toThrowError(
      expect.objectContaining({ reason: "not_found" }),
    );
  });

  it("los roles no widget no quedan atados a una sesion", () => {
    expect(() => requireSession(operator, "chat-9")).not.toThrow();
  });
});

describe("roles: ruta autenticada", () => {
  it("sin token responde 401 con la envoltura de errores", async () => {
    const response = await getIdentity(new Request("http://localhost/api/v1/me"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.request_id).toEqual(expect.any(String));
  });

  it("con token invalido responde 401 sin revelar la causa", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a", secret: "otro-secreto" });
    const response = await getIdentity(authorized(token));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.message).not.toMatch(/firma|signature|secret/i);
  });

  it("con token expirado responde 401", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a", expiresIn: "-1s" });
    const response = await getIdentity(authorized(token));

    expect(response.status).toBe(401);
  });

  it("con emisor ajeno responde 401", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a", issuer: "otro-emisor" });
    const response = await getIdentity(authorized(token));

    expect(response.status).toBe(401);
  });

  it("el tenant sale del claim del token", async () => {
    const token = await signToken({ role: "operator", tenantId: "tenant-b", subject: "op-7" });
    const response = await getIdentity(authorized(token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ subject: "op-7", tenant_id: "tenant-b", role: "operator" });
  });

  it("ignora un tenant inyectado por header o query", async () => {
    const token = await signToken({ role: "operator", tenantId: "tenant-a" });
    const request = new Request("http://localhost/api/v1/me?tenant_id=tenant-b", {
      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": "tenant-b" },
    });
    const body = await (await getIdentity(request)).json();

    expect(body.tenant_id).toBe("tenant-a");
  });

  it("widget no alcanza rutas de dominio", async () => {
    const token = await signToken({ role: "widget", tenantId: "tenant-a", sessionId: "chat-1" });
    const response = await getPractitioners(
      new Request("http://localhost/api/v1/practitioners", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(403);
  });
});
