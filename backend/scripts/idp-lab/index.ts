/**
 * Reconstruye el realm del laboratorio OIDC (`chatbot-lab`) por la API de administracion.
 * Idempotente. Unico lugar del repo con codigo especifico del proveedor.
 *
 * Uso: npm --prefix backend run idp:lab
 * Env: IDP_ADMIN_URL, IDP_ADMIN_REALM (master), IDP_ADMIN_CLIENT_ID, IDP_ADMIN_CLIENT_SECRET,
 *      LAB_API_URL, LAB_FRONTEND_URLS, LAB_USER_PASSWORD, LAB_SERVICE_SECRET,
 *      LAB_PUSH_WIDGET_CLIENTS (true).
 */
import { createHash } from "node:crypto";
import { seedId } from "../../prisma/seed/data";
import { AdminClient, fetchClientToken } from "./admin-client";
import { applyPlan } from "./apply";
import { API_AUDIENCE, buildLabPlan, type LabPlan, REALM } from "./plan";

const SLUGS = ["clinica-norte", "clinica-sur"] as const;
const REQUIRED = [
  "IDP_ADMIN_URL",
  "IDP_ADMIN_CLIENT_ID",
  "IDP_ADMIN_CLIENT_SECRET",
  "LAB_API_URL",
  "LAB_USER_PASSWORD",
  "LAB_SERVICE_SECRET",
] as const;

type LabEnv = {
  adminUrl: string;
  adminRealm: string;
  adminClientId: string;
  adminClientSecret: string;
  apiUrl: string;
  frontendUrls: string[];
  userPassword: string;
  serviceSecret: string;
  push: boolean;
};

function readEnv(): LabEnv {
  const env = process.env;
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`Faltan variables de entorno obligatorias: ${missing.join(", ")}`);
    process.exit(1);
  }
  const extra = (env.LAB_FRONTEND_URLS ?? "").split(",").map((u) => u.trim());
  const frontendUrls = [...new Set(["http://localhost:3000", ...extra.filter(Boolean)])];
  return {
    adminUrl: (env.IDP_ADMIN_URL as string).replace(/\/+$/, ""),
    adminRealm: env.IDP_ADMIN_REALM || "master",
    adminClientId: env.IDP_ADMIN_CLIENT_ID as string,
    adminClientSecret: env.IDP_ADMIN_CLIENT_SECRET as string,
    apiUrl: (env.LAB_API_URL as string).replace(/\/+$/, ""),
    frontendUrls,
    userPassword: env.LAB_USER_PASSWORD as string,
    serviceSecret: env.LAB_SERVICE_SECRET as string,
    push: (env.LAB_PUSH_WIDGET_CLIENTS ?? "true") === "true",
  };
}

async function pushWidgetClients(
  env: LabEnv,
  tenants: { id: string; slug: string }[],
  secrets: Record<string, string>,
): Promise<void> {
  const platform = secrets["chatbot-platform"] as string;
  const token = await fetchClientToken(env.adminUrl, REALM, "chatbot-platform", platform);
  for (const tenant of tenants) {
    const clientId = `widget-${tenant.id}`;
    const secret = secrets[clientId] as string;
    const digest = createHash("sha256").update(secret).digest("hex").slice(0, 16);
    const response = await fetch(
      `${env.apiUrl}/api/platform/v1/tenants/${tenant.id}/widget-client`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": `idp-lab:${tenant.id}:${digest}`,
        },
        body: JSON.stringify({ client_id: clientId, client_secret: secret }),
      },
    );
    const note = response.status === 404 ? "tenant aun no sembrado (omitido)" : "";
    console.log(`push widget-client ${tenant.slug}: ${response.status} ${note}`.trim());
  }
}

function printEnv(env: LabEnv, plan: LabPlan, secrets: Record<string, string>): void {
  const service = { "*": { client_id: "service-{tenant}", client_secret: env.serviceSecret } };
  console.log(`\nOIDC_ISSUER=${env.adminUrl}/realms/${REALM}`);
  console.log(`OIDC_AUDIENCE=${API_AUDIENCE}`);
  console.log("OIDC_LOGOUT_AUDIENCES=chatbot-reference-ui");
  console.log(`HERMES_SIM_SERVICE_CLIENTS=${JSON.stringify(service)}`);
  console.log(`\nPLATFORM_CLIENT_ID=chatbot-platform`);
  console.log(`PLATFORM_CLIENT_SECRET=${secrets["chatbot-platform"]}`);
  console.log("\nUsuarios (password = LAB_USER_PASSWORD):");
  for (const user of plan.users) console.log(`  ${user.username} tenant_id=${user.tenantId}`);
}

async function main(): Promise<void> {
  const env = readEnv();
  const tenants = SLUGS.map((slug) => ({ id: seedId(`tenant:${slug}`), slug }));
  const plan = buildLabPlan({ tenants, apiUrl: env.apiUrl, frontendUrls: env.frontendUrls });
  const admin = await AdminClient.connect({
    baseUrl: env.adminUrl,
    realm: env.adminRealm,
    clientId: env.adminClientId,
    clientSecret: env.adminClientSecret,
  });
  const result = await applyPlan(admin, plan, {
    userPassword: env.userPassword,
    serviceSecret: env.serviceSecret,
  });
  console.log(`Creado en esta ejecucion: ${result.created.length}`);
  for (const item of result.created) console.log(`  + ${item}`);
  printEnv(env, plan, result.clientSecrets);
  if (env.push) await pushWidgetClients(env, tenants, result.clientSecrets);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
