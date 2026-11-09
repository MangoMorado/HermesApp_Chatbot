import { describe, expect, it } from "vitest";
import { type AuthProfile, authPrerequest } from "../scripts/postman/auth";
import {
  buildPostmanCollection,
  type Fragment,
  newmanFolders,
  type PostmanItem,
} from "../scripts/postman/build-collection";
import { buildEnvironmentTemplate } from "../scripts/postman/environment";
import { exampleFromSchema } from "../scripts/postman/examples";

const FRAGMENTS: Fragment[] = [{ name: "prueba", item: [] }];
const collection = buildPostmanCollection(FRAGMENTS);

function folder(items: readonly PostmanItem[], name: string): PostmanItem {
  const found = items.find((item) => item.name === name);
  if (!found) {
    throw new Error(`Sin carpeta ${name}`);
  }
  return found;
}

function requests(item: PostmanItem): PostmanItem[] {
  return item.item ? item.item.flatMap(requests) : [item];
}

const catalog = folder(collection.item, "catálogo");
const sub = (name: string) => folder(catalog.item ?? [], name);
const prerequestOf = (item: PostmanItem) =>
  (item.event ?? [])
    .filter((e) => e.listen === "prerequest")
    .flatMap((e) => e.script.exec)
    .join("\n");

describe("postman: generador de la coleccion", () => {
  it("el catalogo tiene una peticion por operacion declarada", () => {
    const generated = ["chatbot", "platform", "sim"].flatMap((name) => requests(sub(name)));
    expect(generated).toHaveLength(56 - 2);
    expect(requests(sub("manual — rompe el laboratorio"))).toHaveLength(2);
  });

  it("los fragmentos van antes del catalogo", () => {
    expect(collection.item.map((item) => item.name)).toEqual(["prueba", "catálogo"]);
  });

  it("Newman nunca ejecuta el catalogo", () => {
    expect(newmanFolders(FRAGMENTS)).toEqual(["prueba"]);
  });

  it("las escrituras llevan Idempotency-Key", () => {
    const all = requests(catalog);
    const writes = all.filter((item) => item.request && item.request.method !== "GET");
    const withoutKey = writes.filter(
      (item) => !item.request?.header.some((h) => h.key === "Idempotency-Key"),
    );
    expect(withoutKey.map((item) => item.name)).toEqual([
      "POST /api/v1/auth/backchannel-logout",
      "POST /api/v1/medical-records/search",
    ]);
  });

  it("el simulador usa usuario admin y plataforma usa el cliente", () => {
    expect(prerequestOf(sub("sim"))).toContain("grant_type=password");
    expect(prerequestOf(sub("platform"))).toContain("grant_type=client_credentials");
  });

  it("ningun secreto en la plantilla", () => {
    const template = buildEnvironmentTemplate();
    expect(template.values.length).toBeGreaterThan(10);
    expect(template.values.every((v) => v.value === "")).toBe(true);
    expect(template.values.find((v) => v.key === "lab_user_password")?.type).toBe("secret");
  });

  it("la coleccion no contiene keycloak ni oidc.invalid", () => {
    const text = JSON.stringify(collection).toLowerCase();
    expect(text).not.toContain("keycloak");
    expect(text).not.toContain("oidc.invalid");
  });

  it("los ids de peticion son deterministas", () => {
    expect(JSON.stringify(buildPostmanCollection(FRAGMENTS))).toBe(JSON.stringify(collection));
  });
});

describe("postman: ejemplos desde el esquema", () => {
  it("resuelve $ref, enum y prefija los textos libres", () => {
    const components = {
      schemas: {
        Input: {
          type: "object",
          required: ["name", "kind"],
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["a", "b"] },
            extra: { type: "integer" },
          },
        },
      },
    };
    expect(exampleFromSchema({ $ref: "#/components/schemas/Input" }, components)).toEqual({
      name: "newman-ejemplo",
      kind: "a",
    });
  });
});

type FakeRequest = { url: string; body: { raw: string } };

/** `pm` falso: variables en memoria y un token endpoint que cuenta llamadas. */
function fakePm(cached?: { token: string; expiresInMs: number }) {
  const local = new Map<string, string>([
    ["oidc_token_url", "https://idp/token"],
    ["newman_client_id", "chatbot-newman"],
    ["newman_client_secret", "s"],
    ["tenant_a_slug", "clinica-norte"],
    ["lab_user_password", "pw"],
  ]);
  const collectionVars = new Map<string, string>();
  const sent: FakeRequest[] = [];
  if (cached) {
    collectionVars.set("token_user_admin_a", cached.token);
    collectionVars.set("token_exp_user_admin_a", String(Date.now() + cached.expiresInMs));
  }
  const store = (map: Map<string, string>) => ({
    get: (key: string) => map.get(key),
    set: (key: string, value: string) => map.set(key, value),
  });
  const pm = {
    variables: store(local),
    collectionVariables: store(collectionVars),
    request: { headers: { remove: () => undefined } },
    sendRequest: (request: FakeRequest, callback: (e: unknown, r: unknown) => void) => {
      sent.push(request);
      callback(null, { json: () => ({ access_token: "nuevo", expires_in: 300 }) });
    },
  };
  return { pm, sent, local };
}

function runPrerequest(profile: AuthProfile, pm: unknown): void {
  new Function("pm", authPrerequest(profile).join("\n"))(pm);
}

describe("postman: pre-request de autenticacion", () => {
  it("el pre-request renueva antes de caducar", () => {
    const soon = fakePm({ token: "viejo", expiresInMs: 10_000 });
    runPrerequest({ user: "admin_a" }, soon.pm);
    expect(soon.sent).toHaveLength(1);
    expect(soon.sent[0]?.body.raw).toContain("username=admin-clinica-norte");
    expect(soon.local.get("access_token")).toBe("nuevo");
  });

  it("con un token vigente no pide otro", () => {
    const fresh = fakePm({ token: "vigente", expiresInMs: 120_000 });
    runPrerequest({ user: "admin_a" }, fresh.pm);
    expect(fresh.sent).toHaveLength(0);
    expect(fresh.local.get("access_token")).toBe("vigente");
  });
});
