import { getContainer } from "@/composition-root";
import { forbidden } from "@/modules/auth/domain/auth-error";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * CORS solo para las rutas del widget (refinamiento 7 de la spec 3.3). La peticion previa no
 * trae tenant: se devuelve el origen exacto si algun tenant lo admite, nunca un comodin. El
 * control por tenant sigue en la apertura (admitWidget) y en assertSessionOrigin.
 */
const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = `Authorization, Content-Type, Idempotency-Key, ${REQUEST_ID_HEADER}`;
const MAX_AGE_SECONDS = "600";

async function allowedOrigin(request: Request): Promise<string | null> {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return null;
  }
  return (await getContainer().isWidgetOriginRegistered(origin)) ? origin : null;
}

function applyCors(headers: Headers, origin: string): void {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", REQUEST_ID_HEADER);
  // `set` y no `append`: evita un `Vary: Origin` duplicado si otra capa ya lo puso.
  headers.set("Vary", "Origin");
}

/** Envuelve un handler del widget: anade las cabeceras CORS a toda respuesta, incluso de error. */
export function withWidgetCors(
  handler: (request: Request, context?: unknown) => Promise<Response>,
): (request: Request, context?: unknown) => Promise<Response> {
  return async (request, context) => {
    const response = await handler(request, context);
    const origin = await allowedOrigin(request);
    if (origin) {
      applyCors(response.headers, origin);
    }
    return response;
  };
}

export async function widgetPreflight(request: Request): Promise<Response> {
  const response = new Response(null, { status: 204 });
  response.headers.set("Vary", "Origin");
  const origin = await allowedOrigin(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
    response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
    response.headers.set("Access-Control-Max-Age", MAX_AGE_SECONDS);
  }
  return response;
}

/** Con token, el navegador debe hablar desde el mismo origen que abrio la sesion. */
export function assertSessionOrigin(request: Request, session: { readonly origin: string }): void {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin.toLowerCase() !== session.origin.toLowerCase()) {
    throw forbidden("Origen distinto al de la sesion");
  }
}
