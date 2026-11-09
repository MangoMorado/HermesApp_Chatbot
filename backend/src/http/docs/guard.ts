import type { DocsWiring } from "@/composition/docs-wiring";
import { getContainer } from "@/composition-root";

/**
 * Adaptador de entrada de `/docs` (spec 5.3 §3). Apagado responde el mismo `404` sin cuerpo
 * que una ruta inexistente, para no revelar que existe. Encendido, toda respuesta lleva una
 * CSP propia: scripts solo del mismo origen y conexiones al propio API y al proveedor.
 */
export function docsContentSecurityPolicy(issuer: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${new URL(issuer).origin}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

export function notFound(): Response {
  return new Response(null, { status: 404 });
}

type DocsHandler = (docs: DocsWiring) => Promise<Response> | Response;

export async function docsRoute(handler: DocsHandler): Promise<Response> {
  const { docs, config } = getContainer();
  if (!docs.enabled) {
    return notFound();
  }
  const response = await handler(docs);
  response.headers.set("Content-Security-Policy", docsContentSecurityPolicy(config.oidc.issuer));
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
