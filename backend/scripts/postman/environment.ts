import { postmanEnvironment, postmanValues } from "../idp-lab/postman-env";

/**
 * Plantilla versionada del entorno de Postman: las mismas claves que imprime `idp:lab`, todas
 * vacias. Los valores reales salen de `idp:lab` (o de `LAB_POSTMAN_ENV_OUT`).
 */
export function buildEnvironmentTemplate() {
  const keys = postmanValues({
    issuer: "",
    apiUrl: "",
    userPassword: "",
    serviceSecret: "",
    tenants: [],
    secrets: {},
  });
  return postmanEnvironment(
    keys.map((entry) => ({ ...entry, value: "" })),
    "chatbot-lab (plantilla)",
  );
}
