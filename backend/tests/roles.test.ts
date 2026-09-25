import { describe, expect, it } from "vitest";
import { POST as issuePlatformToken } from "@/app/api/platform/v1/tokens/route";
import { GET as getSimInbox } from "@/app/api/sim/v1/inbox/route";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { GET as getPractitioners } from "@/app/api/v1/practitioners/route";
import { resetContainer } from "@/composition-root";
import { requireRole, requireSession, requireTenant } from "@/modules/auth/application/authorize";
import type { Actor } from "@/modules/auth/domain/actor";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { createJoseTokenIssuer } from "@/modules/auth/infrastructure/jose-token-issuer";
import { createJoseTokenVerifier } from "@/modules/auth/infrastructure/jose-token-verifier";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { authorized, signToken, TEST_JWT } from "./helpers/token";

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

describe("roles: emision de tokens", () => {
  const issuer = createJoseTokenIssuer(TEST_JWT);
  const verifier = createJoseTokenVerifier(TEST_JWT);

  it("un token emitido lo acepta el verificador con los mismos claims", async () => {
    const now = new Date();
    const token = await issuer.issue({
      subject: "ana@clinica",
      tenantId: "tenant-a",
      role: "admin",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(await verifier.verify(token)).toEqual({
      subject: "ana@clinica",
      tenantId: "tenant-a",
      role: "admin",
    });
  });

  it("el token de widget lleva su sesion", async () => {
    const now = new Date();
    const token = await issuer.issue({
      subject: "widget:s-1",
      tenantId: "tenant-a",
      role: "widget",
      sessionId: "s-1",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect((await verifier.verify(token)).sessionId).toBe("s-1");
  });

  it("un token ya vencido no se acepta", async () => {
    const past = new Date(Date.now() - 120_000);
    const token = await issuer.issue({
      subject: "ana",
      tenantId: "tenant-a",
      role: "operator",
      issuedAt: past,
      expiresAt: new Date(past.getTime() + 60_000),
    });
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});

const PLATFORM_SECRET = "secreto-de-plataforma-de-pruebas-con-32-o-mas";

function platformRequest(authorization: string | null, body: unknown): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  return new Request("http://localhost/api/platform/v1/tokens", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("roles: superficie de plataforma", () => {
  const body = { tenant_id: "tenant-a", role: "widget", subject: "x" };

  it("sin secreto responde 401", async () => {
    expect((await issuePlatformToken(platformRequest(null, body))).status).toBe(401);
  });

  it("con secreto incorrecto responde 401", async () => {
    const response = await issuePlatformToken(platformRequest("Bearer otro-secreto", body));
    expect(response.status).toBe(401);
  });

  it("un JWT valido de admin no abre la plataforma", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a" });
    expect((await issuePlatformToken(platformRequest(`Bearer ${token}`, body))).status).toBe(401);
  });

  it("no emite tokens de widget", async () => {
    const response = await issuePlatformToken(platformRequest(`Bearer ${PLATFORM_SECRET}`, body));
    expect(response.status).toBe(422);
    expect((await response.json()).error.details.field).toBe("role");
  });

  it("sin PLATFORM_SECRET configurado toda la superficie responde 404", async () => {
    const saved = process.env.PLATFORM_SECRET;
    delete process.env.PLATFORM_SECRET;
    resetContainer();
    try {
      const response = await issuePlatformToken(platformRequest(`Bearer ${PLATFORM_SECRET}`, body));
      expect(response.status).toBe(404);
    } finally {
      process.env.PLATFORM_SECRET = saved;
      resetContainer();
    }
  });
});

describe("roles: bandeja del simulador", () => {
  it("operator y widget reciben 403", async () => {
    for (const role of ["operator", "widget"] as const) {
      const token = await signToken({
        role,
        tenantId: "tenant-a",
        sessionId: role === "widget" ? "s-1" : undefined,
      });
      const response = await getSimInbox(authorized(token));
      expect(response.status).toBe(403);
    }
  });

  it("con el simulador apagado, admin recibe 404", async () => {
    resetContainer();
    const token = await signToken({ role: "admin", tenantId: "tenant-a" });
    const response = await getSimInbox(authorized(token));
    expect(response.status).toBe(404);
  });
});
