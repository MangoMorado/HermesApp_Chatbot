/**
 * Proxy same-origin hacia el backend. El navegador solo habla con el dominio del
 * frontend, así que no hace falta CORS. No aplica reglas: reenvía método, cuerpo y
 * una lista cerrada de cabeceras, y devuelve la respuesta tal cual.
 */

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "idempotency-key",
  "x-request-id",
] as const;

const FORWARDED_RESPONSE_HEADERS = ["content-type", "x-request-id", "retry-after"] as const;

/** URL de destino, o `null` si el camino intenta salir de `/api/` del backend. */
export function targetUrl(base: string, segments: readonly string[], search: string): URL | null {
  const origin = new URL(base);
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  const target = new URL(`/api/${path}${search}`, origin);
  if (target.origin !== origin.origin || !target.pathname.startsWith("/api/")) {
    return null;
  }
  return target;
}

function pick(source: Headers, names: readonly string[]): Headers {
  const picked = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) {
      picked.set(name, value);
    }
  }
  return picked;
}

export async function forward(
  request: Request,
  base: string,
  segments: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const target = targetUrl(base, segments, new URL(request.url).search);
  if (!target) {
    return Response.json(
      { error: { code: "not_found", message: "Ruta no encontrada", request_id: "" } },
      { status: 404 },
    );
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetchImpl(target, {
    method: request.method,
    headers: pick(request.headers, FORWARDED_REQUEST_HEADERS),
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
    redirect: "manual",
  });
  return new Response(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: pick(upstream.headers, FORWARDED_RESPONSE_HEADERS),
  });
}
