import type { AppConfig } from "../config/env";
import { buildOpenApiDocument } from "../http/openapi";
import { buildPlatformOpenApiDocument } from "../http/openapi-platform";
import { withProviderUrls } from "../http/openapi-security";
import { buildSimOpenApiDocument } from "../http/openapi-sim";
import type { OidcDiscovery } from "../modules/auth/infrastructure/oidc-discovery";

export type DocsContractName = "chatbot" | "platform" | "sim";

export type DocsContract = { readonly name: DocsContractName; readonly title: string };

export type DocsWiring = {
  readonly enabled: boolean;
  readonly oidcClientId: string;
  readonly contracts: readonly DocsContract[];
  /** `null` si el nombre no es un contrato ofrecido; rechaza si el discovery falla. */
  servedDocument(name: string): Promise<unknown>;
};

const BUILDERS: Readonly<Record<DocsContractName, () => unknown>> = {
  chatbot: buildOpenApiDocument,
  platform: buildPlatformOpenApiDocument,
  sim: buildSimOpenApiDocument,
};

const ALL_CONTRACTS: readonly DocsContract[] = [
  { name: "chatbot", title: "Chatbot (/api/v1)" },
  { name: "platform", title: "Plataforma (/api/platform/v1)" },
  { name: "sim", title: "Simulador Hermes (/api/sim/v1)" },
];

/**
 * Lo que necesitan las rutas de `/docs`: que contratos se ofrecen y cada documento con los
 * marcadores OAuth2 sustituidos por los endpoints del proveedor configurado.
 */
export function docsWiring(config: AppConfig, discovery: () => Promise<OidcDiscovery>): DocsWiring {
  const contracts = ALL_CONTRACTS.filter(
    (contract) => contract.name !== "sim" || config.hermesSimulatorEnabled,
  );
  return {
    enabled: config.docs.enabled,
    oidcClientId: config.docs.oidcClientId,
    contracts,
    async servedDocument(name) {
      const contract = contracts.find((candidate) => candidate.name === name);
      if (!contract) {
        return null;
      }
      const { authorizationEndpoint, tokenEndpoint } = await discovery();
      return withProviderUrls(BUILDERS[contract.name](), { authorizationEndpoint, tokenEndpoint });
    },
  };
}
