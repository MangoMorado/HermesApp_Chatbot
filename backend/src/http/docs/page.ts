import type { DocsContract } from "@/composition/docs-wiring";

export type DocsPageInput = {
  readonly contracts: readonly DocsContract[];
  readonly oidcClientId: string;
};

/** La configuracion viaja como JSON inerte: `init.js` la lee y la CSP no necesita inline. */
function configScript(input: DocsPageInput): string {
  const config = {
    urls: input.contracts.map((contract) => ({
      url: `/docs/openapi/${contract.name}.json`,
      name: contract.title,
    })),
    clientId: input.oidcClientId,
  };
  // `<` escapado: el JSON no puede cerrar la etiqueta script.
  return JSON.stringify(config).replace(/</g, "\\u003c");
}

export function docsPage(input: DocsPageInput): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contrato REST — Chatbot Ingenius 360</title>
<link rel="icon" type="image/png" href="/docs/assets/favicon-32x32.png">
<link rel="stylesheet" href="/docs/assets/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script type="application/json" id="docs-config">${configScript(input)}</script>
<script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
<script src="/docs/assets/init.js"></script>
</body>
</html>
`;
}

/** Pagina de retorno OAuth2 de Swagger UI, con su script servido desde `/docs/assets`. */
export function oauth2RedirectPage(): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>OAuth2</title></head>
<body>
<script src="/docs/assets/oauth2-redirect.js"></script>
</body>
</html>
`;
}

/** Arranque de Swagger UI: lee `docs-config` y activa PKCE con el cliente publico. */
export const INIT_SCRIPT = `(() => {
  const config = JSON.parse(document.getElementById("docs-config").textContent);
  const ui = SwaggerUIBundle({
    urls: config.urls,
    dom_id: "#swagger-ui",
    deepLinking: true,
    // Sin la insignia del validador publico: /docs no habla con terceros.
    validatorUrl: null,
    persistAuthorization: false,
    oauth2RedirectUrl: window.location.origin + "/docs/oauth2-redirect.html",
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout",
  });
  ui.initOAuth({
    clientId: config.clientId,
    scopes: "openid",
    usePkceWithAuthorizationCodeGrant: true,
  });
  window.ui = ui;
})();
`;
