"use client";

import { ApiClientError } from "@/lib/api-fetcher";

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }
  if (error instanceof ApiClientError) {
    return (
      <p className="error" role="alert">
        {error.message}
        {error.body?.error.request_id ? ` · request_id: ${error.body.error.request_id}` : null}
      </p>
    );
  }
  if (error instanceof Error) {
    return (
      <p className="error" role="alert">
        {error.message}
      </p>
    );
  }
  return (
    <p className="error" role="alert">
      Error inesperado
    </p>
  );
}
