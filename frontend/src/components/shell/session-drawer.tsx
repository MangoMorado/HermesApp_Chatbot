"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { clearToken, setToken } from "@/lib/token";
import { useIdentity, useToken } from "@/lib/use-session";

function TokenForm() {
  const [draft, setDraft] = useState("");
  const token = useToken();

  return (
    <form
      className="session-form"
      action={() => {
        if (draft.trim()) {
          setToken(draft.trim());
          setDraft("");
        }
      }}
    >
      <Field label="Token JWT" apiKey="Authorization: Bearer" className="field-token">
        <input
          id="jwt"
          className="input data"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={token ? "Pega otro token para cambiar de sesión" : "eyJhbGciOi…"}
        />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
        {token ? "Cambiar" : "Guardar"}
      </button>
      {token ? (
        <button type="button" className="btn" onClick={() => clearToken()}>
          Cerrar sesión
        </button>
      ) : null}
    </form>
  );
}

function Claims() {
  const token = useToken();
  const identity = useIdentity();
  if (!token) {
    return (
      <p className="hint">Sin token no hay sesión. El backend resuelve rol y tenant del JWT.</p>
    );
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
      <dd>{me.tenant_id}</dd>
      <dt>subject</dt>
      <dd>{me.subject}</dd>
    </dl>
  );
}

/** Franja de sesión bajo la marquesina: pegar el JWT y ver lo que /me confirma. */
export function SessionDrawer() {
  return (
    <section id="session" className="session-drawer" aria-label="Sesión">
      <div>
        <h2>Sesión</h2>
        <TokenForm />
        <p className="hint">
          Pídelo al proveedor de identidad (el laboratorio lo imprime con{" "}
          <code>npm run idp:lab</code>). Vive en sessionStorage.
        </p>
      </div>
      <div>
        <h2>Lo que confirma el backend</h2>
        <Claims />
      </div>
    </section>
  );
}
