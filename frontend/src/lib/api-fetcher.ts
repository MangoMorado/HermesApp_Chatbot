import { IDEMPOTENCY_HEADER, settleIdempotencyKey } from "./idempotency";
import { getToken } from "./token";

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

/**
 * Mutator orval: fetch + Bearer desde sessionStorage. Las URLs son relativas
 * (`/api/v1/...`): las atiende el proxy same-origin de `app/api/[...path]`.
 */
export async function apiFetcher<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });
  const idempotencyKey = headers.get(IDEMPOTENCY_HEADER);
  if (response.ok && idempotencyKey) {
    settleIdempotencyKey(idempotencyKey);
  }
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      data && typeof data === "object" && "error" in data ? (data as ApiErrorBody) : null,
      `HTTP ${response.status}`,
    );
  }

  return data as T;
}
