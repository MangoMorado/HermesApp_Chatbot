import { afterEach, describe, expect, it } from "vitest";
import { GET as getPlatformIdentity } from "@/app/api/platform/v1/me/route";
import { GET as getSimInbox } from "@/app/api/sim/v1/inbox/route";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { GET as getPractitioners } from "@/app/api/v1/practitioners/route";
import { resetContainer } from "@/composition-root";
import { createAuthenticate } from "@/modules/auth/application/authenticate";
import {
  requirePlatformActor,
  requireTenant,
  requireTenantActor,
} from "@/modules/auth/application/authorize";
import type { Actor, PlatformActor } from "@/modules/auth/domain/actor";
import { AuthError } from "@/modules/auth/domain/auth-error";
import { IdentityUnavailableError } from "@/modules/auth/domain/machine-credential-error";
import type { ClosedSessions } from "@/modules/auth/domain/ports/closed-sessions";
import type { TokenClaims } from "@/modules/auth/domain/ports/token-verifier";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { fhirGet, fhirPut, fhirSend, serviceToken } from "./helpers/fhir";
import {
  authedRequest,
  authorized,
  resetFakeIdp,
  setFakeIdpDown,
  signToken,
} from "./helpers/idp";

const operator: Actor = {
  subject: "u-1",
  tenantId: toTenantId("tenant-a"),
  role: "operator",
};
const widget: Actor = { subject: "s-1", tenantId: toTenantId("tenant-a"), role: "widget" };
const platform: PlatformActor = { subject: "p-1", role: "platform" };

describe("roles: autorizacion en el nucleo", () => {
  it("admite el rol declarado por la ruta", () => {
    expect(requireTenantActor(operator, ["operator", "admin"])).toBe(operator);
  });

  it("rechaza con forbidden un rol fuera de la lista", () => {
    expect(() => requireTenantActor(widget, ["operator", "admin"])).toThrowError(
      expect.objectContaining({ reason: "forbidden" }),
    );
  });

  it("platform no es un actor de tenant", () => {
    expect(() => requireTenantActor(platform, ["operator", "admin", "service"])).toThrowError(
      expect.objectContaining({ reason: "forbidden" }),
    );
  });

  it("solo platform alcanza la superficie de plataforma", () => {
    expect(requirePlatformActor(platform)).toBe(platform);
    expect(() => requirePlatformActor(operator)).toThrowError(
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
});

function authenticateWith(claims: TokenClaims, closedSessions: ClosedSessions) {
  return createAuthenticate({
    verifier: { verify: async () => claims },
    closedSessions,
    clock: { now: () => new Date("2026-10-27T10:00:00Z") },
  });
}

const neverClosed: ClosedSessions = { close: async () => {}, isClosed: async () => false };

describe("roles: authenticate", () => {
  it("claims sin tenant y rol platform producen un actor platform", async () => {
    const authenticate = authenticateWith(
      { subject: "p", role: "platform", tenantId: null },
      neverClosed,
    );
    expect(await authenticate("Bearer x")).toEqual({ subject: "p", role: "platform" });
  });

  it("claims de tenant producen un actor con tenant", async () => {
    const authenticate = authenticateWith(
      { subject: "a", role: "admin", tenantId: "t", providerSessionId: "sid-1" },
      neverClosed,
    );
    expect(await authenticate("Bearer x")).toEqual({ subject: "a", role: "admin", tenantId: "t" });
  });

  it("claims de tenant sin tenant son unauthorized", async () => {
    const authenticate = authenticateWith(
      { subject: "a", role: "admin", tenantId: null },
      neverClosed,
    );
    await expect(authenticate("Bearer x")).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("una sesion del proveedor cerrada es unauthorized", async () => {
    const authenticate = authenticateWith(
      { subject: "a", role: "admin", tenantId: "t", providerSessionId: "sid-1" },
      { close: async () => {}, isClosed: async (sid) => sid === "sid-1" },
    );
    await expect(authenticate("Bearer x")).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("si la base de sesiones cerradas falla el error no se disfraza de 401", async () => {
    const failure = new Error("base caida");
    const authenticate = authenticateWith(
      { subject: "a", role: "admin", tenantId: "t", providerSessionId: "sid-1" },
      {
        close: async () => {},
        isClosed: async () => {
          throw failure;
        },
      },
    );
    await expect(authenticate("Bearer x")).rejects.toBe(failure);
  });

  it("un proveedor inalcanzable no se disfraza de 401", async () => {
    const unavailable = new IdentityUnavailableError();
    const authenticate = createAuthenticate({
      verifier: {
        verify: async () => {
          throw unavailable;
        },
      },
      closedSessions: { close: async () => {}, isClosed: async () => false },
      clock: { now: () => new Date() },
    });
    await expect(authenticate("Bearer x")).rejects.toBe(unavailable);
  });
});

describe("roles: proveedor de identidad caido", () => {
  afterEach(() => {
    resetFakeIdp();
    resetContainer();
  });

  it("discovery/JWKS inalcanzable → 503 identity_unavailable en una ruta privada", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a" });
    resetContainer();
    setFakeIdpDown(true);
    const response = await getIdentity(authorized(token));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("identity_unavailable");
  });

  it("con el proveedor arriba, una firma ajena sigue siendo 401", async () => {
    resetContainer();
    const token = await signToken({ role: "admin", tenantId: "tenant-a", foreignKey: true });
    expect((await getIdentity(authorized(token))).status).toBe(401);
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
    const token = await signToken({ role: "admin", tenantId: "tenant-a", foreignKey: true });
    const response = await getIdentity(authorized(token));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.message).not.toMatch(/firma|signature|secret/i);
  });

  it("con token HS256 responde 401", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a", alg: "HS256" });
    expect((await getIdentity(authorized(token))).status).toBe(401);
  });

  it("con token expirado responde 401", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a", expiresIn: "-5m" });
    const response = await getIdentity(authorized(token));

    expect(response.status).toBe(401);
  });

  it("sin exp responde 401", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a", withoutExp: true });
    expect((await getIdentity(authorized(token))).status).toBe(401);
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
    const token = await signToken({ role: "widget", tenantId: "tenant-a" });
    const response = await getPractitioners(
      new Request("http://localhost/api/v1/practitioners", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("platform se identifica en /api/platform/v1/me", async () => {
    const token = await signToken({ role: "platform" });
    const response = await getPlatformIdentity(
      authedRequest("http://localhost/api/platform/v1/me", token),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subject: expect.any(String), role: "platform" });
  });

  it("un rol de clinica no alcanza /api/platform/v1/me", async () => {
    const token = await signToken({ role: "admin", tenantId: "tenant-a" });
    const response = await getPlatformIdentity(
      authedRequest("http://localhost/api/platform/v1/me", token),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });

  it("platform no alcanza rutas de tenant", async () =>
    expect((await getIdentity(authorized(await signToken({ role: "platform" })))).status).toBe(
      403,
    ));

  it("tenant fuera de una ruta FHIR con token platform → 403", async () =>
    expect((await fhirGet("Patient", await signToken({ role: "platform" }))).response.status).toBe(
      403,
    ));

  it("token sin sid se acepta", async () =>
    expect(
      (await getIdentity(authorized(await signToken({ role: "admin", tenantId: "t" })))).status,
    ).toBe(200));

  it("cero o dos roles → 401", async () => {
    const none = await signToken({ roles: [], tenantId: "t" });
    const two = await signToken({ roles: ["admin", "operator"], tenantId: "t" });
    for (const token of [none, two]) {
      expect((await getIdentity(authorized(token))).status).toBe(401);
    }
  });
});

describe("roles: bandeja del simulador", () => {
  it("operator y widget reciben 403", async () => {
    for (const role of ["operator", "widget"] as const) {
      const token = await signToken({
        role,
        tenantId: "tenant-a",
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

describe("roles: /fhir", () => {
  const FHIR_MIME = "application/fhir+json";

  it("operator, admin y widget reciben 403 con OperationOutcome", async () => {
    for (const role of ["operator", "admin", "widget"] as const) {
      const token = await signToken({
        role,
        tenantId: "tenant-a",
      });
      const { response, body } = await fhirGet("Patient", token);

      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
      expect(body.resourceType).toBe("OperationOutcome");
      expect(body.issue[0].code).toBe("forbidden");
      expect(body.error).toBeUndefined();
    }
  });

  it("sin token responde 401 login sin revelar la causa", async () => {
    const { response, body } = await fhirGet("Patient/mr-1");

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
    expect(body.issue[0]).toEqual({
      severity: "error",
      code: "login",
      diagnostics: "Credenciales ausentes o invalidas",
    });
  });

  it("un token expirado o de otro emisor responde 401 con el mismo mensaje", async () => {
    const expired = await signToken({ role: "service", tenantId: "tenant-a", expiresIn: "-5m" });
    const foreign = await signToken({ role: "service", tenantId: "tenant-a", issuer: "otro" });
    for (const token of [expired, foreign]) {
      const { response, body } = await fhirGet("Slot", token);
      expect(response.status).toBe(401);
      expect(body.issue[0].diagnostics).toBe("Credenciales ausentes o invalidas");
    }
  });

  it("sin rol service una ruta inexistente responde 401 o 403, nunca 404", async () => {
    const operator = await signToken({ role: "operator", tenantId: "tenant-a" });
    expect((await fhirGet("Inventado/x")).response.status).toBe(401);
    expect((await fhirGet("")).response.status).toBe(401);
    expect((await fhirGet("Inventado/x", operator)).response.status).toBe(403);
  });

  it("una escritura condicional sin rol service responde 403, no valida la clave", async () => {
    const operator = await signToken({ role: "operator", tenantId: "tenant-a" });
    const { response, body } = await fhirPut(
      "Patient?identifier=urn:test|patient-1",
      operator,
      { resourceType: "Patient" },
      { "Idempotency-Key": "" },
    );

    expect(response.status).toBe(403);
    expect(body.issue[0].code).toBe("forbidden");
    expect((await fhirSend("POST", "metadata")).response.status).toBe(401);
  });

  it("metadata responde 200 sin token", async () => {
    const { response, body } = await fhirGet("metadata");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(FHIR_MIME);
    expect(response.headers.get("X-Request-Id")).toEqual(expect.any(String));
    expect(body.resourceType).toBe("CapabilityStatement");
  });

  it("con rol service, un tipo desconocido responde 404 y una escritura 405", async () => {
    const token = await serviceToken("tenant-a");
    const unknown = await fhirGet("Inventado/x", token);
    expect(unknown.response.status).toBe(404);
    expect(unknown.body.issue[0].code).toBe("not-found");
    expect((await fhirGet("", token)).response.status).toBe(404);
    expect((await fhirGet("Patient/a/b", token)).response.status).toBe(404);

    const write = await fhirSend("PUT", "Patient/mr-1", token);
    expect(write.response.status).toBe(405);
    expect(write.response.headers.get("Allow")).toBe("GET");
    expect(write.body.issue[0].code).toBe("not-supported");
    expect((await fhirSend("DELETE", "Inventado/x", token)).response.status).toBe(404);
  });

  it("valida ruta y media type antes de exigir Idempotency-Key", async () => {
    const token = await serviceToken("tenant-a");
    const byId = await fhirPut("Patient/mr-1", token, {}, { "Idempotency-Key": "" });
    expect(byId.response.status).toBe(405);
    expect(byId.response.headers.get("Allow")).toBe("GET");

    const appointment = await fhirPut(
      "Appointment?identifier=urn:test|appointment-1",
      token,
      {},
      { "Idempotency-Key": "" },
    );
    expect(appointment.response.status).toBe(405);
    expect(appointment.response.headers.get("Allow")).toBe("GET");

    const mediaType = await fhirPut(
      "Patient?identifier=urn:test|patient-1",
      token,
      {},
      { "Content-Type": "text/plain", "Idempotency-Key": "" },
    );
    expect(mediaType.response.status).toBe(415);
    expect(mediaType.body.issue[0].code).toBe("not-supported");
  });

  it("exige Idempotency-Key despues de validar el destino escribible", async () => {
    const token = await serviceToken("tenant-a");
    const { response, body } = await fhirPut(
      "Patient?identifier=urn:test|patient-1",
      token,
      {},
      { "Idempotency-Key": "" },
    );

    expect(response.status).toBe(400);
    expect(body.issue[0].code).toBe("invalid");
    expect(body.issue[0].diagnostics).toContain("Idempotency-Key");
  });
});
