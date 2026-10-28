/**
 * Estado deseado del laboratorio OIDC. Puro: sin red ni env, para probarlo sin servidor.
 * Es el unico lugar del repo que conoce los tipos de mapper del proveedor concreto.
 */
export const REALM = "chatbot-lab";
export const API_AUDIENCE = "chatbot-api";
export const SCOPE_NAME = "chatbot-contract";
export const ROLES = ["widget", "operator", "admin", "service", "platform"] as const;
export type LabRole = (typeof ROLES)[number];

export type MapperPlan = { name: string; type: string; config: Record<string, string> };
export type ClientPlan = {
  clientId: string;
  public: boolean;
  pkce?: "S256";
  redirectUris: string[];
  backchannelLogoutUrl?: string;
  serviceRole?: LabRole;
  hardcodedTenant?: string;
  fixedSecret?: "service";
  mappers: MapperPlan[];
};
export type UserPlan = { username: string; tenantId: string; role: LabRole };
export type LabPlan = {
  realm: { name: string; accessTokenLifespan: number };
  userProfileAttributes: string[];
  roles: LabRole[];
  clientScope: { name: string; mappers: MapperPlan[] };
  clients: ClientPlan[];
  users: UserPlan[];
};
export type LabInput = {
  tenants: { id: string; slug: string }[];
  apiUrl: string;
  frontendUrls: string[];
};

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

function scopeMappers(): MapperPlan[] {
  return [
    {
      name: "roles",
      type: "oidc-usermodel-realm-role-mapper",
      config: {
        "claim.name": "roles",
        multivalued: "true",
        "jsonType.label": "String",
        "access.token.claim": "true",
        "id.token.claim": "false",
        "userinfo.token.claim": "false",
      },
    },
    {
      name: "tenant_id",
      type: "oidc-usermodel-attribute-mapper",
      config: {
        "user.attribute": "tenant_id",
        "claim.name": "tenant_id",
        "jsonType.label": "String",
        "access.token.claim": "true",
        "id.token.claim": "false",
        "userinfo.token.claim": "false",
      },
    },
    {
      name: "audience",
      type: "oidc-audience-mapper",
      config: {
        "included.custom.audience": API_AUDIENCE,
        "access.token.claim": "true",
        "id.token.claim": "false",
      },
    },
  ];
}

function tenantClaimMapper(tenantId: string): MapperPlan {
  return {
    name: "tenant_id-fijo",
    type: "oidc-hardcoded-claim-mapper",
    config: {
      "claim.name": "tenant_id",
      "claim.value": tenantId,
      "jsonType.label": "String",
      "access.token.claim": "true",
      "id.token.claim": "false",
      "userinfo.token.claim": "false",
    },
  };
}

function machineClients(tenantId: string): ClientPlan[] {
  const base = { public: false, redirectUris: [], hardcodedTenant: tenantId };
  const mappers = [tenantClaimMapper(tenantId)];
  return [
    { ...base, clientId: `widget-${tenantId}`, serviceRole: "widget", mappers },
    {
      ...base,
      clientId: `service-${tenantId}`,
      serviceRole: "service",
      fixedSecret: "service",
      mappers,
    },
  ];
}

function interactiveClients(input: LabInput): ClientPlan[] {
  const api = trimSlash(input.apiUrl);
  return [
    {
      clientId: "chatbot-reference-ui",
      public: true,
      pkce: "S256",
      redirectUris: input.frontendUrls.map((url) => `${trimSlash(url)}/*`),
      backchannelLogoutUrl: `${api}/api/v1/auth/backchannel-logout`,
      mappers: [],
    },
    {
      clientId: "chatbot-swagger",
      public: true,
      pkce: "S256",
      redirectUris: [`${api}/docs/*`],
      mappers: [],
    },
  ];
}

export function buildLabPlan(input: LabInput): LabPlan {
  const platform: ClientPlan = {
    clientId: "chatbot-platform",
    public: false,
    redirectUris: [],
    serviceRole: "platform",
    mappers: [],
  };
  return {
    realm: { name: REALM, accessTokenLifespan: 300 },
    userProfileAttributes: ["tenant_id"],
    roles: [...ROLES],
    clientScope: { name: SCOPE_NAME, mappers: scopeMappers() },
    clients: [
      platform,
      ...input.tenants.flatMap((t) => machineClients(t.id)),
      ...interactiveClients(input),
    ],
    users: input.tenants.flatMap((t) =>
      (["admin", "operator"] as const).map((role) => ({
        username: `${role}-${t.slug}`,
        tenantId: t.id,
        role,
      })),
    ),
  };
}
