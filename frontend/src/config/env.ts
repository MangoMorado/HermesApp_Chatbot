/**
 * Único punto del frontend que lee `process.env`, y solo en el servidor.
 * Se lee en cada petición (no se hornea en el build): cambiar `BACKEND_URL`
 * en el entorno no exige recompilar la imagen.
 */
export function backendUrl(): string {
  return process.env.BACKEND_URL ?? "http://localhost:3001";
}
