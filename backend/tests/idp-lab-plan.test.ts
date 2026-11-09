import { describe, expect, it } from "vitest";
import { clientBody, userAttributes } from "../scripts/idp-lab/apply";
import { buildLabPlan } from "../scripts/idp-lab/plan";
import { postmanEnvironment, postmanValues } from "../scripts/idp-lab/postman-env";

const plan = buildLabPlan({
  tenants: [{ id: "t-n", slug: "clinica-norte" }],
  apiUrl: "https://api.x",
  frontendUrls: ["http://localhost:3000"],
});

describe("idp-lab plan", () => {
  it("un widget y un service por tenant, con claim fijo", () => {
    expect(plan.clients.find((c) => c.clientId === "widget-t-n")?.hardcodedTenant).toBe("t-n");
    expect(plan.clients.find((c) => c.clientId === "service-t-n")?.serviceRole).toBe("service");
  });
  it("reference-ui publico, PKCE y back-channel a la API", () => {
    expect(plan.clients.find((c) => c.clientId === "chatbot-reference-ui")).toMatchObject({
      public: true,
      pkce: "S256",
      backchannelLogoutUrl: "https://api.x/api/v1/auth/backchannel-logout",
      redirectUris: ["http://localhost:3000/*"],
    });
  });
  it("atributo tenant_id declarado en el user profile", () => {
    expect(plan.userProfileAttributes).toContain("tenant_id");
  });
  it("vida de acceso 300 s", () => expect(plan.realm.accessTokenLifespan).toBe(300));
  it("usuarios admin y operator por tenant", () => {
    expect(plan.users.map((u) => u.username)).toEqual([
      "admin-clinica-norte",
      "operator-clinica-norte",
      "platform-lab",
    ]);
  });
  it("platform-lab tiene rol platform y no lleva tenant", () => {
    expect(plan.users.find((u) => u.username === "platform-lab")).toEqual({
      username: "platform-lab",
      role: "platform",
    });
  });
  it("userAttributes fija tenant_id o lo quita", () => {
    expect(userAttributes({ x: ["1"] }, { username: "a", role: "admin", tenantId: "t" })).toEqual({
      x: ["1"],
      tenant_id: ["t"],
    });
    expect(
      userAttributes({ x: ["1"], tenant_id: ["viejo"] }, { username: "p", role: "platform" }),
    ).toEqual({ x: ["1"] });
    expect(userAttributes(undefined, { username: "p", role: "platform" })).toEqual({});
  });
  it("roles, scope y plataforma", () => {
    expect(plan.roles).toEqual(["widget", "operator", "admin", "service", "platform"]);
    expect(plan.clientScope.mappers.map((m) => m.type)).toEqual([
      "oidc-usermodel-realm-role-mapper",
      "oidc-usermodel-attribute-mapper",
      "oidc-audience-mapper",
    ]);
    expect(plan.clients.find((c) => c.clientId === "chatbot-platform")?.serviceRole).toBe(
      "platform",
    );
  });
  it("chatbot-newman es confidencial y con password grant", () => {
    expect(plan.clients.find((c) => c.clientId === "chatbot-newman")).toMatchObject({
      public: false,
      redirectUris: [],
      directAccessGrants: true,
    });
  });
  it("ningun otro cliente tiene password grant", () => {
    expect(plan.clients.filter((c) => c.directAccessGrants).map((c) => c.clientId)).toEqual([
      "chatbot-newman",
    ]);
  });
  it("clientBody traduce directAccessGrants", () => {
    const newman = plan.clients.find((c) => c.clientId === "chatbot-newman");
    const swagger = plan.clients.find((c) => c.clientId === "chatbot-swagger");
    expect(newman && clientBody(newman, "s").directAccessGrantsEnabled).toBe(true);
    expect(newman && clientBody(newman, "s").standardFlowEnabled).toBe(false);
    expect(swagger && clientBody(swagger, "s").directAccessGrantsEnabled).toBe(false);
  });
});

describe("idp-lab salida para Postman", () => {
  const input = {
    issuer: "https://idp.x/realms/chatbot-lab",
    apiUrl: "https://api.x",
    userPassword: "pw",
    serviceSecret: "svc",
    tenants: [
      { id: "t-n", slug: "clinica-norte" },
      { id: "t-s", slug: "clinica-sur" },
    ],
    secrets: { "chatbot-newman": "nw", "chatbot-platform": "pf" },
  };

  it("valores de las dos primeras clinicas y token URL del issuer", () => {
    const values = Object.fromEntries(postmanValues(input).map((v) => [v.key, v.value]));
    expect(values).toMatchObject({
      base_url: "https://api.x",
      oidc_token_url: "https://idp.x/realms/chatbot-lab/protocol/openid-connect/token",
      newman_client_id: "chatbot-newman",
      newman_client_secret: "nw",
      platform_client_id: "chatbot-platform",
      platform_client_secret: "pf",
      tenant_a_id: "t-n",
      tenant_a_slug: "clinica-norte",
      service_a_client_id: "service-t-n",
      service_a_client_secret: "svc",
      tenant_b_id: "t-s",
      service_b_client_id: "service-t-s",
      lab_user_password: "pw",
    });
  });

  it("los secretos van marcados como secret en el entorno", () => {
    const env = postmanEnvironment(postmanValues(input));
    const secret = env.values.filter((v) => v.type === "secret").map((v) => v.key);
    expect(secret.sort()).toEqual([
      "lab_user_password",
      "newman_client_secret",
      "platform_client_secret",
      "service_a_client_secret",
      "service_b_client_secret",
    ]);
  });
});
