import { createHandlerFhirHttp } from "@/composition/handler-fhir-http";
import type { AppConfig } from "@/config/env";
import { createJoseTokenIssuer } from "@/modules/auth/infrastructure/jose-token-issuer";
import { createFhirChatbotGateway } from "@/modules/hermes-simulator/application/fhir-gateway";
import { createServiceTokens } from "@/modules/hermes-simulator/application/service-tokens";
import type { ChatbotRequestsGateway } from "@/modules/hermes-simulator/domain/ports/inbox";
import { createFetchFhirHttp } from "@/modules/hermes-simulator/infrastructure/fetch-fhir-http";

function unusedGateway(): ChatbotRequestsGateway {
  const fail = () => Promise.reject(new Error("El simulador esta apagado"));
  return { listPending: fail, get: fail, resolve: fail };
}

/** Cliente FHIR del simulador. Con el simulador apagado nadie lo llama. */
export function simulatorGateway(config: AppConfig): ChatbotRequestsGateway {
  if (!config.hermesSimulatorEnabled) {
    return unusedGateway();
  }
  if (config.fhirGateway === "fetch" && !config.fhirBaseUrl) {
    throw new Error("FHIR_BASE_URL es obligatoria cuando el simulador habla por HTTP");
  }
  const http =
    config.fhirGateway === "handlers"
      ? createHandlerFhirHttp()
      : createFetchFhirHttp(config.fhirBaseUrl ?? "");
  return createFhirChatbotGateway({
    http,
    tokens: createServiceTokens(createJoseTokenIssuer(config.jwt)),
  });
}
