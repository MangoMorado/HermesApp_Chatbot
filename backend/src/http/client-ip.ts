/**
 * IP del cliente para el rate limit. Solo se confia en X-Forwarded-For detras de un proxy
 * propio (Traefik en Easypanel descarta el X-Forwarded-For que manda el cliente y pone el
 * suyo). Sin TRUST_PROXY todo cae en un cubo comun: restrictivo pero imposible de evadir.
 */
export function clientIp(request: Request, trustProxy: boolean): string | null {
  if (!trustProxy) {
    return null;
  }
  const first = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return first ? first : null;
}
