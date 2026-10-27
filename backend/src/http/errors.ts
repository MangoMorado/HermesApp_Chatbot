import { NextResponse } from "next/server";
import { AuthError } from "@/modules/auth/domain/auth-error";
import {
  IdentityUnavailableError,
  MachineCredentialMissingError,
} from "@/modules/auth/domain/machine-credential-error";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { InvalidRequestError } from "@/modules/shared/domain/invalid-request-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { type ErrorCode, STATUS_BY_CODE } from "./error-codes";
import { REQUEST_ID_HEADER } from "./request-id";

export type ErrorBody = {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly request_id: string;
    readonly details?: unknown;
  };
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/** Traduce el error del nucleo al contrato HTTP sin filtrar detalle interno. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof ValidationError) {
    return new ApiError("validation_failed", error.message, error.details);
  }
  if (error instanceof InvalidRequestError) {
    return new ApiError("invalid_request", error.message);
  }
  if (error instanceof NotFoundError) {
    return new ApiError("not_found", error.message);
  }
  if (error instanceof ConflictError) {
    return new ApiError("conflict", error.message, error.details);
  }
  if (error instanceof RateLimitedError) {
    return new ApiError("rate_limited", error.message, {
      retry_after_seconds: error.retryAfterSeconds,
    });
  }
  if (error instanceof MachineCredentialMissingError) {
    return new ApiError("widget_not_configured", "La clinica no tiene credenciales de widget");
  }
  if (error instanceof IdentityUnavailableError) {
    return new ApiError("identity_unavailable", "Proveedor de identidad no disponible");
  }
  if (error instanceof AuthError) {
    return new ApiError(error.reason, error.message);
  }
  return new ApiError("internal_error", "Error interno");
}

export function errorResponse(error: ApiError, requestId: string): NextResponse<ErrorBody> {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      request_id: requestId,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };

  const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
  const retryAfter = retryAfterOf(error);
  if (retryAfter !== null) {
    headers["Retry-After"] = String(retryAfter);
  }
  return NextResponse.json(body, { status: STATUS_BY_CODE[error.code], headers });
}

function retryAfterOf(error: ApiError): number | null {
  if (error.code !== "rate_limited" || !error.details || typeof error.details !== "object") {
    return null;
  }
  const seconds = (error.details as { retry_after_seconds?: unknown }).retry_after_seconds;
  return typeof seconds === "number" ? seconds : null;
}
