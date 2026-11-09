import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { INIT_SCRIPT } from "./page";

/**
 * Activos de Swagger UI servidos desde el paquete `swagger-ui-dist`, nunca desde un CDN.
 * Lista cerrada: un nombre fuera de ella (incluido cualquier intento de salir del
 * directorio) es `404` sin tocar el disco.
 */
const JS = "text/javascript; charset=utf-8";

const PACKAGE_ASSETS: Readonly<Record<string, string>> = {
  "swagger-ui.css": "text/css; charset=utf-8",
  "swagger-ui-bundle.js": JS,
  "swagger-ui-standalone-preset.js": JS,
  "oauth2-redirect.js": JS,
  "favicon-32x32.png": "image/png",
};

const OWN_ASSETS: Readonly<Record<string, string>> = { "init.js": INIT_SCRIPT };

export const ALLOWED_ASSETS: ReadonlySet<string> = new Set([
  ...Object.keys(PACKAGE_ASSETS),
  ...Object.keys(OWN_ASSETS),
]);

/** En `standalone` el paquete entra por `outputFileTracingIncludes` (next.config.ts). */
function packageDirectory(): string {
  return join(process.cwd(), "node_modules", "swagger-ui-dist");
}

const CACHE = "public, max-age=3600";

export async function docsAsset(name: string): Promise<Response | null> {
  if (!ALLOWED_ASSETS.has(name)) {
    return null;
  }
  if (Object.hasOwn(OWN_ASSETS, name)) {
    return new Response(OWN_ASSETS[name], {
      headers: { "Content-Type": JS, "Cache-Control": CACHE },
    });
  }
  const bytes = await readFile(join(packageDirectory(), name));
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": PACKAGE_ASSETS[name] ?? JS, "Cache-Control": CACHE },
  });
}
