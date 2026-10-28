import { type UserManagerSettings, WebStorageStateStore } from "oidc-client-ts";

export type OidcConfig = { readonly issuer: string; readonly clientId: string };

/**
 * Authorization Code + PKCE contra un cliente público: sin secreto en el navegador. La sesión
 * vive en `sessionStorage` (por pestaña) y se renueva sola con el `refresh_token`.
 */
export function buildSettings(
  config: OidcConfig,
  origin: string,
  store: Storage,
): UserManagerSettings {
  return {
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: "code",
    scope: "openid",
    automaticSilentRenew: true,
    monitorSession: false,
    userStore: new WebStorageStateStore({ store }),
  };
}
