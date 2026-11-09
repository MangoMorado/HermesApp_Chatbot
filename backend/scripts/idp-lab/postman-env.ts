/**
 * Variables del entorno de Postman que el laboratorio conoce (spec 5.3 §4.3). Puro: la
 * plantilla versionada (`docs/lab.postman_environment.template.json`) sale de las mismas
 * claves con valores vacios.
 */
export type PostmanValue = { key: string; value: string; secret: boolean };

export type PostmanEnvironment = {
  name: string;
  values: { key: string; value: string; type: "default" | "secret"; enabled: true }[];
  _postman_variable_scope: "environment";
};

export type PostmanEnvInput = {
  issuer: string;
  apiUrl: string;
  userPassword: string;
  serviceSecret: string;
  tenants: readonly { id: string; slug: string }[];
  secrets: Readonly<Record<string, string>>;
};

const LETTERS = ["a", "b"] as const;

function tenantValues(input: PostmanEnvInput): PostmanValue[] {
  return LETTERS.flatMap((letter, index) => {
    const tenant = input.tenants[index];
    return [
      { key: `tenant_${letter}_id`, value: tenant?.id ?? "", secret: false },
      { key: `tenant_${letter}_slug`, value: tenant?.slug ?? "", secret: false },
      {
        key: `service_${letter}_client_id`,
        value: tenant ? `service-${tenant.id}` : "",
        secret: false,
      },
      {
        key: `service_${letter}_client_secret`,
        value: tenant ? input.serviceSecret : "",
        secret: true,
      },
    ];
  });
}

export function postmanValues(input: PostmanEnvInput): PostmanValue[] {
  const issuer = input.issuer.replace(/\/+$/, "");
  return [
    { key: "base_url", value: input.apiUrl, secret: false },
    { key: "oidc_token_url", value: `${issuer}/protocol/openid-connect/token`, secret: false },
    { key: "newman_client_id", value: "chatbot-newman", secret: false },
    { key: "newman_client_secret", value: input.secrets["chatbot-newman"] ?? "", secret: true },
    { key: "platform_client_id", value: "chatbot-platform", secret: false },
    {
      key: "platform_client_secret",
      value: input.secrets["chatbot-platform"] ?? "",
      secret: true,
    },
    ...tenantValues(input),
    { key: "lab_user_password", value: input.userPassword, secret: true },
  ];
}

export function postmanEnvironment(values: readonly PostmanValue[], name = "chatbot-lab") {
  const environment: PostmanEnvironment = {
    name,
    values: values.map((v) => ({
      key: v.key,
      value: v.value,
      type: v.secret ? "secret" : "default",
      enabled: true,
    })),
    _postman_variable_scope: "environment",
  };
  return environment;
}
