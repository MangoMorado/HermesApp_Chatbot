/**
 * Esquemas de seguridad de los tres contratos OpenAPI (spec 5.3 §3.3). El JSON versionado
 * lleva marcadores fijos en las URLs OAuth2 para seguir siendo determinista; `/docs` los
 * sustituye al servir por los endpoints del proveedor configurado (`withProviderUrls`).
 */

export const OAUTH_PLACEHOLDERS = {
  authorizationUrl: "https://oidc.invalid/authorize",
  tokenUrl: "https://oidc.invalid/token",
} as const;

export const SECURITY_SCHEMES = {
  oidcUser: {
    type: "oauth2",
    description: "Usuario de la clinica (admin u operator) o de plataforma, con PKCE.",
    flows: {
      authorizationCode: {
        authorizationUrl: OAUTH_PLACEHOLDERS.authorizationUrl,
        tokenUrl: OAUTH_PLACEHOLDERS.tokenUrl,
        scopes: { openid: "Identidad OIDC" },
      },
    },
  },
  oidcClient: {
    type: "oauth2",
    description: "Cliente de maquina (service de una clinica o plataforma).",
    flows: { clientCredentials: { tokenUrl: OAUTH_PLACEHOLDERS.tokenUrl, scopes: {} } },
  },
  widgetSession: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Token devuelto por POST /widget/sessions",
  },
} as const;

export const USER = [{ oidcUser: [] }];
export const CLIENT = [{ oidcClient: [] }];
export const WIDGET = [{ widgetSession: [] }];
export const USER_OR_CLIENT = [{ oidcUser: [] }, { oidcClient: [] }];
export const ANY_IDENTITY = [{ widgetSession: [] }, { oidcUser: [] }, { oidcClient: [] }];

export type ProviderEndpoints = {
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string;
};

type Json = unknown;

function replacePlaceholders(value: Json, endpoints: ProviderEndpoints): Json {
  if (value === OAUTH_PLACEHOLDERS.tokenUrl) {
    return endpoints.tokenEndpoint;
  }
  if (value === OAUTH_PLACEHOLDERS.authorizationUrl) {
    return endpoints.authorizationEndpoint;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, endpoints));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, endpoints)]),
    );
  }
  return value;
}

/** Quita `oidcUser` de las alternativas de `security`; una lista que se vacia desaparece. */
function dropUserRequirement(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(dropUserRequirement);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value).flatMap(([key, item]) => {
    if (key === "security" && Array.isArray(item) && item.length > 0) {
      const kept = item.filter((requirement) => !("oidcUser" in requirement));
      return kept.length > 0 ? [[key, kept] as const] : [];
    }
    return [[key, dropUserRequirement(item)] as const];
  });
  return Object.fromEntries(entries);
}

type WithSchemes = { components?: { securitySchemes?: Record<string, unknown> } };

function withoutUserScheme(document: WithSchemes): WithSchemes {
  const cleaned = dropUserRequirement(document) as WithSchemes;
  const schemes = { ...(cleaned.components?.securitySchemes ?? {}) };
  delete schemes.oidcUser;
  return { ...cleaned, components: { ...cleaned.components, securitySchemes: schemes } };
}

/**
 * Copia el documento sustituyendo los marcadores por los endpoints del proveedor. Sin
 * `authorization_endpoint` (proveedor que solo hace client_credentials), el flujo de usuario
 * no se puede ofrecer: se quita el esquema `oidcUser` y sus usos. No muta la entrada.
 */
export function withProviderUrls<T>(document: T, endpoints: ProviderEndpoints): T {
  const replaced = replacePlaceholders(document, endpoints) as WithSchemes;
  if (endpoints.authorizationEndpoint === null) {
    return withoutUserScheme(replaced) as T;
  }
  return replaced as T;
}
