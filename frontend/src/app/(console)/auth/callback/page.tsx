"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthActions } from "@/lib/auth/auth-provider";
import { completeSignIn } from "@/lib/auth/bind";

function providerError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  return error ? (params.get("error_description") ?? error) : null;
}

/** Vuelta del proveedor tras el login: canjea el `code` (PKCE) y regresa a la pantalla de origen. */
export default function AuthCallbackPage() {
  const { manager, signIn } = useAuthActions();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const rejected = providerError();
    if (rejected) {
      setFailure(rejected);
      return;
    }
    if (!manager) {
      return;
    }
    completeSignIn(manager).then(
      (target) => router.replace(target),
      (error: unknown) => setFailure(error instanceof Error ? error.message : "Error inesperado"),
    );
  }, [manager, router]);

  return (
    <div className="page-head">
      <div>
        <h1>Inicio de sesión</h1>
        {failure ? (
          <>
            <p role="alert">El proveedor de identidad no completó el inicio de sesión: {failure}</p>
            <button type="button" className="btn btn-primary" onClick={() => void signIn()}>
              Volver a intentar
            </button>
          </>
        ) : (
          <p>Completando el inicio de sesión…</p>
        )}
      </div>
    </div>
  );
}
