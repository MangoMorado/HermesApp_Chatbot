/**
 * Cierra el ciclo de Hermes por `/fhir`: sincroniza maestros, resuelve la pre-agenda
 * y confirma pre-registros. Exige el simulador encendido y `FHIR_BASE_URL`.
 * Uso: npm run hermes:sync
 */
import { loadConfig } from "../src/config/env";
import { createJoseTokenIssuer } from "../src/modules/auth/infrastructure/jose-token-issuer";
import { createFhirChatbotClient } from "../src/modules/hermes-simulator/application/fhir-client";
import { createHermesSync } from "../src/modules/hermes-simulator/application/hermes-sync";
import { createApproveInboxRequest } from "../src/modules/hermes-simulator/application/inbox";
import { createServiceTokens } from "../src/modules/hermes-simulator/application/service-tokens";
import { createFetchFhirHttp } from "../src/modules/hermes-simulator/infrastructure/fetch-fhir-http";
import { createPrismaSimCatalog } from "../src/modules/hermes-simulator/infrastructure/prisma-catalog";
import { createPrismaHermesSession } from "../src/modules/hermes-simulator/infrastructure/prisma-hermes-session";
import { createPrismaClient } from "../src/modules/shared/infrastructure/prisma-client";
import { uuidV7Generator } from "../src/modules/shared/infrastructure/uuid-v7-generator";

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.hermesSimulatorEnabled) {
    refuse("HERMES_SIMULATOR_ENABLED debe ser true");
  }
  if (!config.fhirBaseUrl) {
    refuse("FHIR_BASE_URL es obligatoria para hermes:sync");
  }
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const http = createFetchFhirHttp(config.fhirBaseUrl);
    const tokens = createServiceTokens(createJoseTokenIssuer(config.jwt));
    const chatbot = createFhirChatbotClient({ http, tokens });
    const sync = createHermesSync({
      catalog: createPrismaSimCatalog(prisma),
      http,
      tokens,
      chatbot,
      approve: createApproveInboxRequest({
        chatbot,
        session: createPrismaHermesSession(prisma),
        ids: uuidV7Generator,
      }),
    });
    const tenants = await prisma.tenant.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    for (const tenant of tenants) {
      const report = await sync(tenant.id);
      process.stdout.write(`${tenant.id} ${JSON.stringify(report)}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "hermes:sync fallo";
  refuse(message);
});
