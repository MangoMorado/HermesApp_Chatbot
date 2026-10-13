/**
 * Mutator orval del widget. A diferencia de `lib/api-fetcher.ts`, habla con el backend por
 * su URL absoluta (CORS desde el sitio del tenant) y solo conoce el token de la sesión del
 * widget: nunca lee el JWT del panel ni envía cookies.
 */
export type WidgetRequestInit = RequestInit & {
  /** Origen del backend, sin barra final (p. ej. `https://api.clinica.co`). */
  readonly apiBase?: string;
  /** Token de la sesión del widget. */
  readonly token?: string;
};

/** Envoltura de errores REST (`error.code`, `error.message`, `error.details`), sin fiarse de su forma. */
type ErrorBody = { readonly error?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WidgetApiError extends Error {
  /** Código HTTP; `0` cuando no hubo respuesta (red caída, DNS, CORS). */
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ErrorBody | null, fallback: string) {
    const error = isRecord(body?.error) ? body.error : {};
    super(typeof error.message === "string" ? error.message : fallback);
    this.name = "WidgetApiError";
    this.status = status;
    this.code = typeof error.code === "string" ? error.code : null;
    this.details = isRecord(error.details) ? error.details : {};
  }

  /** Motivo de un `409` (`details.reason`), p. ej. `stale_option`. */
  get reason(): string | null {
    const reason = this.details.reason;
    return typeof reason === "string" ? reason : null;
  }

  /** Espera de un `429`. Viene en el cuerpo: `Retry-After` no es legible por CORS. */
  get retryAfterSeconds(): number | null {
    const seconds = this.details.retry_after_seconds;
    return typeof seconds === "number" ? seconds : null;
  }

  /** Sin respuesta o `5xx`: el mismo envío puede repetirse con la misma `Idempotency-Key`. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/** `undefined` si el cuerpo no es JSON; `null` si viene vacío. */
function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function widgetFetcher<T>(url: string, options?: WidgetRequestInit): Promise<T> {
  const { apiBase = "", token, ...init } = options ?? {};
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase}${url}`, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new WidgetApiError(0, null, "Sin conexión con el servidor");
  }
  if (!response.ok) {
    const body = parseJson(await response.text());
    throw new WidgetApiError(
      response.status,
      isRecord(body) ? body : null,
      `HTTP ${response.status}`,
    );
  }
  const data = parseJson(await response.text());
  if (data === undefined) {
    throw new WidgetApiError(response.status, null, "Respuesta sin JSON");
  }
  return data as T;
}
