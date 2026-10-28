"use client";

import { ApiClientError } from "@/lib/api-fetcher";

function describe(error: unknown): { code: string; message: string; requestId?: string } {
  if (error instanceof ApiClientError) {
    return {
      code: error.body?.error.code ?? `HTTP ${error.status}`,
      message: error.message,
      requestId: error.body?.error.request_id,
    };
  }
  if (error instanceof Error) {
    return { code: "cliente", message: error.message };
  }
  return { code: "cliente", message: "Error inesperado" };
}

/** Fila de aviso: código del contrato, mensaje del backend y request_id para rastrear. */
export function ErrorBox({ error }: { readonly error: unknown }) {
  if (!error) {
    return null;
  }
  const { code, message, requestId } = describe(error);
  return (
    <div className="notice" role="alert">
      <span className="notice-code data">{code}</span>
      <span>{message}</span>
      {requestId ? (
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => navigator.clipboard?.writeText(requestId)}
        >
          Copiar request_id
        </button>
      ) : (
        <span />
      )}
      {requestId ? <span className="notice-trace data">request_id {requestId}</span> : null}
    </div>
  );
}
