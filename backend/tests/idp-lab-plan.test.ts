import { describe, expect, it } from "vitest";
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
    ]);
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
