/**
 * Scripts de pre-peticion de Postman que obtienen y cachean tokens contra el token endpoint
 * del proveedor (spec 5.3 §4.3). Newman no ejecuta el asistente OAuth2 de Postman: por eso
 * los tokens se piden por script. Los valores salen de variables del entorno, nunca del script.
 */
export type UserProfile = "admin_a" | "operator_a" | "admin_b" | "operator_b" | "platform_lab";
export type ClientProfile = "service_a" | "service_b" | "platform";

export type AuthProfile =
  | "none"
  | "widget"
  | "widget_b"
  | { user: UserProfile }
  | { client: ClientProfile };

/** Margen de renovacion: un token al que le quedan menos de 30 s se cambia por uno nuevo. */
export const RENEW_MARGIN_MS = 30_000;

/** Expresion JS (dentro del script) del nombre de usuario de cada perfil. */
const USERNAMES: Record<UserProfile, string> = {
  admin_a: '"admin-" + pm.variables.get("tenant_a_slug")',
  operator_a: '"operator-" + pm.variables.get("tenant_a_slug")',
  admin_b: '"admin-" + pm.variables.get("tenant_b_slug")',
  operator_b: '"operator-" + pm.variables.get("tenant_b_slug")',
  platform_lab: '"platform-lab"',
};

const CLIENT_VARIABLES: Record<ClientProfile, [string, string]> = {
  service_a: ["service_a_client_id", "service_a_client_secret"],
  service_b: ["service_b_client_id", "service_b_client_secret"],
  platform: ["platform_client_id", "platform_client_secret"],
};

function formBody(profile: { user: UserProfile } | { client: ClientProfile }): string {
  const v = (name: string) => `encodeURIComponent(pm.variables.get("${name}"))`;
  if ("user" in profile) {
    return [
      '"grant_type=password&scope=openid"',
      `"&client_id=" + ${v("newman_client_id")}`,
      `"&client_secret=" + ${v("newman_client_secret")}`,
      `"&username=" + encodeURIComponent(${USERNAMES[profile.user]})`,
      `"&password=" + ${v("lab_user_password")}`,
    ].join(" + ");
  }
  const [id, secret] = CLIENT_VARIABLES[profile.client];
  return [
    '"grant_type=client_credentials"',
    `"&client_id=" + ${v(id)}`,
    `"&client_secret=" + ${v(secret)}`,
  ].join(" + ");
}

function cachedTokenScript(profile: { user: UserProfile } | { client: ClientProfile }): string[] {
  const key = "user" in profile ? `user_${profile.user}` : `client_${profile.client}`;
  return [
    "(function () {",
    `  var cacheKey = "token_${key}";`,
    `  var expKey = "token_exp_${key}";`,
    "  var now = Date.now();",
    "  var cached = pm.collectionVariables.get(cacheKey);",
    "  var exp = Number(pm.collectionVariables.get(expKey) || 0);",
    `  if (cached && exp - now > ${RENEW_MARGIN_MS}) {`,
    '    pm.variables.set("access_token", cached);',
    "    return;",
    "  }",
    "  pm.sendRequest({",
    '    url: pm.variables.get("oidc_token_url"),',
    '    method: "POST",',
    '    header: { "Content-Type": "application/x-www-form-urlencoded" },',
    `    body: { mode: "raw", raw: ${formBody(profile)} },`,
    "  }, function (err, res) {",
    "    if (err) { throw err; }",
    "    var json = res.json();",
    '    if (!json.access_token) { throw new Error("Token endpoint sin access_token"); }',
    "    pm.collectionVariables.set(cacheKey, json.access_token);",
    "    pm.collectionVariables.set(expKey, String(now + json.expires_in * 1000));",
    '    pm.variables.set("access_token", json.access_token);',
    "  });",
    "})();",
  ];
}

export function authPrerequest(profile: AuthProfile): string[] {
  if (profile === "none") {
    return ['pm.request.headers.remove("Authorization");'];
  }
  if (profile === "widget" || profile === "widget_b") {
    const letter = profile === "widget" ? "a" : "b";
    return [
      `pm.variables.set("access_token", pm.collectionVariables.get("widget_token_${letter}"));`,
    ];
  }
  return cachedTokenScript(profile);
}
