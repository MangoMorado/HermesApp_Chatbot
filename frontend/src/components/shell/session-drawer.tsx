"use client";

import { ErrorBox } from "@/components/error-box";
import { useAuthActions } from "@/lib/auth/auth-provider";
import { useAuthStatus, useIdentity } from "@/lib/use-session";

function SessionControls() {
  const status = useAuthStatus();
  const { signIn, signOut } = useAuthActions();
  if (status === "unconfigured") {
    return (
      <p className="hint" role="status">
        Falta configurar el proveedor de identidad (<code>PUBLIC_OIDC_ISSUER</code>,{" "}
        <code>PUBLIC_OIDC_CLIENT_ID</code>).
      </p>
    );
  }
  if (status === "loading") {
    return <p className="hint">Comprobando sesión…</p>;
  }
  if (status === "anonymous") {
    return (
      <button type="button" className="btn btn-primary" onClick={() => void signIn()}>
        Iniciar sesión
      </button>
    );
  }
  return (
    <button type="button" className="btn" onClick={() => void signOut()}>
      Cerrar sesión
    </button>
  );
}

function Claims() {
  const status = useAuthStatus();
  const identity = useIdentity();
  if (status !== "authenticated") {
    return <p className="hint">Sin sesión. El backend resuelve rol y clínica del token.</p>;
  }
  if (identity.isPending) {
    return <p className="hint">Consultando /me…</p>;
  }
  if (identity.isError) {
    return <ErrorBox error={identity.error} />;
  }
  const me = identity.data;
  return (
    <dl className="claims data">
      <dt>role</dt>
      <dd>{me.role}</dd>
      <dt>tenant_id</dt>
      <dd>{me.kind === "tenant" ? me.tenantId : "(sin clínica)"}</dd>
      <dt>subject</dt>
      <dd>{me.subject}</dd>
    </dl>
  );
}

/** Franja de sesión bajo la marquesina: entrar o salir por el proveedor y ver lo que /me confirma. */
export function SessionDrawer() {
  return (
    <section id="session" className="session-drawer" aria-label="Sesión">
      <div>
        <h2>Sesión</h2>
        <div className="session-form">
          <SessionControls />
        </div>
        <p className="hint">
          El inicio de sesión lo hace el proveedor de identidad. Los usuarios de prueba los imprime{" "}
          <code>npm run idp:lab</code>.
        </p>
      </div>
      <div>
        <h2>Lo que confirma el backend</h2>
        <Claims />
      </div>
    </section>
  );
}
