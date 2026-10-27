/** Codigos de error del contrato REST. Estables: el cliente los ramifica. */
export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "method_not_allowed",
  "rate_limited",
  "widget_not_configured",
  "identity_unavailable",
  "invalid_request",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  method_not_allowed: 405,
  rate_limited: 429,
  widget_not_configured: 409,
  identity_unavailable: 503,
  invalid_request: 400,
  internal_error: 500,
};
