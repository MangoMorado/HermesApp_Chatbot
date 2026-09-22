import { NextResponse } from "next/server";
import { AuthError } from "@/modules/auth/domain/auth-error";
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

  return NextResponse.json(body, {
    status: STATUS_BY_CODE[error.code],
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}
