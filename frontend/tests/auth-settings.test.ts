import { describe, expect, it } from "vitest";
import { buildSettings } from "@/lib/auth/settings";

describe("ajustes del cliente OIDC", () => {
  it("buildSettings usa PKCE por code, callback y vuelta al inicio", () => {
    const settings = buildSettings(
      { issuer: "https://idp.x/realms/r", clientId: "ui" },
      "http://localhost:3000",
      sessionStorage,
    );
    expect(settings).toMatchObject({
      authority: "https://idp.x/realms/r",
      client_id: "ui",
      redirect_uri: "http://localhost:3000/auth/callback",
      post_logout_redirect_uri: "http://localhost:3000/",
      response_type: "code",
      scope: "openid",
      automaticSilentRenew: true,
      monitorSession: false,
    });
    expect(settings).not.toHaveProperty("client_secret");
  });
});
