"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { setToken } from "@/lib/token";
import { useAction } from "@/lib/use-action";
import { createTenant, issueToken } from "@/platform/default/default";
import type { TenantCreated } from "@/platform/models/tenantCreated";
import { TokenRequestRole } from "@/platform/models/tokenRequestRole";

function bearer(secret: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${secret.trim()}`);
  return { ...init, headers };
}

export function TenantsPanel() {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [created, setCreated] = useState<TenantCreated | null>(null);
  const [adopted, setAdopted] = useState(false);
  const { pending, error, run } = useAction();
  const ready = Boolean(slug.trim() && name.trim() && secret.trim());

  const create = () =>
    run("create", async () => {
      setCreated(null);
      setAdopted(false);
      const body = { slug: slug.trim(), name: name.trim() };
      const result = await createTenant(
        body,
        bearer(secret, idempotent(`tenant.create:${body.slug}`, body)),
      );
      setCreated(result);
    });

  const adopt = () => {
    if (!created) {
      return;
    }
    const tenantId = created.tenant.id;
    return run("adopt", async () => {
      const issued = await issueToken(
        { tenant_id: tenantId, role: TokenRequestRole.admin, subject: "simulador" },
        bearer(secret),
      );
      setToken(issued.token);
      setAdopted(true);
    });
  };

  return (
    <section className="board" aria-labelledby="tenants-title">
      <TenantHead created={created} adopted={adopted} error={error} />
      <TenantForm
        slug={slug}
        name={name}
        secret={secret}
        ready={ready}
        pending={pending}
        onSlug={setSlug}
        onName={setName}
        onSecret={setSecret}
        onCreate={create}
      />
      {created ? (
        <TenantResult created={created} pending={pending} adopted={adopted} onAdopt={adopt} />
      ) : null}
    </section>
  );
}

function TenantHead({
  created,
  adopted,
  error,
}: {
  readonly created: TenantCreated | null;
  readonly adopted: boolean;
  readonly error: unknown;
}) {
  return (
    <div className="board-head">
      <div className="board-title">
        <h2 id="tenants-title">Agregar tenant</h2>
        <p>Alta con bot, conocimiento de ejemplo y clave de widget. El secreto no se guarda.</p>
      </div>
      <ErrorBox error={error} />
      {created && adopted ? (
        <div className="notice notice-ok" role="status">
          <span className="flap" data-tone="ok">
            SESIÓN
          </span>
          <span>El panel usa ahora el token de admin de {created.tenant.slug}.</span>
        </div>
      ) : null}
    </div>
  );
}

function TenantForm({
  slug,
  name,
  secret,
  ready,
  pending,
  onSlug,
  onName,
  onSecret,
  onCreate,
}: {
  readonly slug: string;
  readonly name: string;
  readonly secret: string;
  readonly ready: boolean;
  readonly pending: string | null;
  readonly onSlug: (value: string) => void;
  readonly onName: (value: string) => void;
  readonly onSecret: (value: string) => void;
  readonly onCreate: () => void;
}) {
  return (
    <form
      className="board-body controls"
      action={() => {
        if (ready) onCreate();
      }}
    >
      <Field label="Nombre" apiKey="name" className="field-wide">
        <input className="input" value={name} onChange={(event) => onName(event.target.value)} />
      </Field>
      <Field label="Slug" apiKey="slug" className="field-narrow">
        <input
          className="input data"
          value={slug}
          pattern="^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$"
          onChange={(event) => onSlug(event.target.value)}
        />
      </Field>
      <Field label="Secreto de plataforma" apiKey="Authorization" className="field-wide">
        <input
          className="input data"
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => onSecret(event.target.value)}
        />
      </Field>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={!ready || pending !== null}
        aria-busy={pending === "create"}
      >
        {pending === "create" ? "Creando…" : "Crear tenant"}
      </button>
    </form>
  );
}

function TenantResult({
  created,
  pending,
  adopted,
  onAdopt,
}: {
  readonly created: TenantCreated;
  readonly pending: string | null;
  readonly adopted: boolean;
  readonly onAdopt: () => void;
}) {
  return (
    <div className="board-body stack">
      <dl className="claims data">
        <dt>tenant_id</dt>
        <dd>{created.tenant.id}</dd>
        <dt>widget_key</dt>
        <dd>{created.widget_key}</dd>
      </dl>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => navigator.clipboard?.writeText(created.widget_key)}
        >
          Copiar clave
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending !== null || adopted}
          aria-busy={pending === "adopt"}
          onClick={onAdopt}
        >
          {adopted ? "Sesión lista" : "Entrar como admin"}
        </button>
      </div>
    </div>
  );
}
