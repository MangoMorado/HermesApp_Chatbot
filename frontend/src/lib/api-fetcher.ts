import { IDEMPOTENCY_HEADER, settleIdempotencyKey } from "./idempotency";
import { getToken, renewToken } from "./token";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: unknown;
  };
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
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

function jsonHeaders(options?: RequestInit): Headers {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function readJson<T>(response: Response, requestHeaders: Headers): Promise<T> {
  const idempotencyKey = requestHeaders.get(IDEMPOTENCY_HEADER);
  if (response.ok && idempotencyKey) {
    settleIdempotencyKey(idempotencyKey);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const data = parseJson(text);
  if (data === undefined) {
    // Una página HTML (proxy caído, error del servidor de desarrollo) no es el contrato REST.
    throw new ApiClientError(response.status, null, `HTTP ${response.status}: respuesta sin JSON`);
  }
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      data && typeof data === "object" && "error" in data ? (data as ApiErrorBody) : null,
      `HTTP ${response.status}`,
    );
  }
  return data as T;
}

function withBearer(headers: Headers, token: string | null): Headers {
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

/**
 * Fetch con el token de la sesión. Ante un `401` pide una renovación y reintenta **una** vez
 * con los mismos cabeceros (misma `Idempotency-Key`) y el mismo cuerpo.
 */
async function authorizedFetch(url: string, options?: RequestInit): Promise<[Response, Headers]> {
  const headers = withBearer(jsonHeaders(options), getToken());
  const response = await fetch(url, { ...options, headers });
  if (response.status !== 401) {
    return [response, headers];
  }
  const renewed = await renewToken();
  if (!renewed) {
    return [response, headers];
  }
  withBearer(headers, renewed);
  return [await fetch(url, { ...options, headers }), headers];
}

/**
 * Mutator orval: fetch + Bearer de la sesión. Las URLs son relativas
 * (`/api/v1/...`): las atiende el proxy same-origin de `app/api/[...path]`.
 */
export async function apiFetcher<T>(url: string, options?: RequestInit): Promise<T> {
  const [response, headers] = await authorizedFetch(url, options);
  return readJson<T>(response, headers);
}

/** Mutator de `/api/platform/v1`: mismo bearer de sesión (persona con rol `platform`). */
export async function platformFetcher<T>(url: string, options?: RequestInit): Promise<T> {
  return apiFetcher<T>(url, options);
}
