/**
 * Único punto del frontend que lee `process.env`, y solo en el servidor.
 * Se lee en cada petición (no se hornea en el build): cambiar `BACKEND_URL`
 * en el entorno no exige recompilar la imagen.
 */
export function backendUrl(): string {
  return process.env.BACKEND_URL ?? "http://localhost:3001";
}

/**
 * URL del backend alcanzable **desde el navegador**: el widget habla directo con él por CORS.
 * Distinta de `BACKEND_URL`, que puede ser una dirección interna de la red de contenedores.
 * También se lee en runtime: las páginas que la usan son dinámicas.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

export function publicBackendUrl(): string {
  return withoutTrailingSlashes(process.env.PUBLIC_BACKEND_URL || "http://localhost:3001");
}

/**
 * Proveedor de identidad de la consola (cliente público con PKCE). Se lee en runtime y pasa
 * al navegador por props; `null` si falta alguna variable (la consola avisa, no se cae).
 */
export function oidcConfig(): { issuer: string; clientId: string } | null {
  const issuer = withoutTrailingSlashes(process.env.PUBLIC_OIDC_ISSUER ?? "");
  const clientId = process.env.PUBLIC_OIDC_CLIENT_ID ?? "";
  return issuer && clientId ? { issuer, clientId } : null;
}
