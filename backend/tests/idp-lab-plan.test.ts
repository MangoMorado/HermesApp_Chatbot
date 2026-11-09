import { describe, expect, it } from "vitest";
import { userAttributes } from "../scripts/idp-lab/apply";
import { buildLabPlan } from "../scripts/idp-lab/plan";

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
});
