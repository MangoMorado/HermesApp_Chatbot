"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/error-box";
import { Field } from "@/components/ui/field";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { createTenant } from "@/platform/default/default";
import type { TenantCreated } from "@/platform/models/tenantCreated";

function bearer(platformToken: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${platformToken.trim()}`);
  return { ...init, headers };
}

export function TenantsPanel() {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [platformToken, setPlatformToken] = useState("");
  const [created, setCreated] = useState<TenantCreated | null>(null);
  const { pending, error, run } = useAction();
  const ready = Boolean(slug.trim() && name.trim() && platformToken.trim());

  const create = () =>
    run("create", async () => {
      setCreated(null);
      const body = { slug: slug.trim(), name: name.trim() };
      const result = await createTenant(
        body,
        bearer(platformToken, idempotent(`tenant.create:${body.slug}`, body)),
      );
      setCreated(result);
    });

  return (
    <section className="board" aria-labelledby="tenants-title">
      <TenantHead error={error} />
      <TenantForm
        slug={slug}
        name={name}
        platformToken={platformToken}
        ready={ready}
        pending={pending}
        onSlug={setSlug}
        onName={setName}
        onPlatformToken={setPlatformToken}
        onCreate={create}
      />
      {created ? <TenantResult created={created} /> : null}
    </section>
  );
}

function TenantHead({ error }: { readonly error: unknown }) {
  return (
    <div className="board-head">
      <div className="board-title">
        <h2 id="tenants-title">Agregar tenant</h2>
        <p>
          Alta con bot, conocimiento de ejemplo y clave de widget. Pega un token de plataforma del
          proveedor de identidad; no se guarda.
        </p>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function TenantForm({
  slug,
  name,
  platformToken,
  ready,
  pending,
  onSlug,
  onName,
  onPlatformToken,
  onCreate,
}: {
  readonly slug: string;
  readonly name: string;
  readonly platformToken: string;
  readonly ready: boolean;
  readonly pending: string | null;
  readonly onSlug: (value: string) => void;
  readonly onName: (value: string) => void;
  readonly onPlatformToken: (value: string) => void;
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
      <Field label="Token de plataforma" apiKey="Authorization" className="field-wide">
        <input
          className="input data"
          type="password"
          autoComplete="off"
          value={platformToken}
          onChange={(event) => onPlatformToken(event.target.value)}
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

function TenantResult({ created }: { readonly created: TenantCreated }) {
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
      </div>
    </div>
  );
}
