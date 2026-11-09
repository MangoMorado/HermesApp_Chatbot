import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getAsset } from "@/app/docs/assets/[file]/route";
import { GET as getRedirect } from "@/app/docs/oauth2-redirect.html/route";
import { GET as getDocument } from "@/app/docs/openapi/[name]/route";
import { GET as getPage } from "@/app/docs/route";
import { resetContainer } from "@/composition-root";
import { resetFakeIdp, setFakeIdpDown, TEST_OIDC } from "../helpers/idp";

const saved = { ...process.env };

beforeEach(() => {
  resetContainer();
  resetFakeIdp();
});

afterEach(() => {
  Object.assign(process.env, saved);
  delete process.env.DOCS_ENABLED;
  resetContainer();
  resetFakeIdp();
});

function enable(simulator = false): void {
  process.env.DOCS_ENABLED = "true";
  process.env.HERMES_SIMULATOR_ENABLED = simulator ? "true" : "false";
  process.env.FHIR_GATEWAY = "handlers";
  resetContainer();
}

const page = () => getPage(new Request("http://localhost/docs"));
const document = (name: string) =>
  getDocument(new Request(`http://localhost/docs/openapi/${name}`), {
    params: Promise.resolve({ name }),
  });
const asset = (file: string) =>
  getAsset(new Request(`http://localhost/docs/assets/${file}`), {
    params: Promise.resolve({ file }),
  });

function docsConfig(html: string): { urls: { url: string; name: string }[]; clientId: string } {
  const match = /<script type="application\/json" id="docs-config">([^<]*)<\/script>/.exec(html);
  return JSON.parse(match?.[1] ?? "null");
}

describe("docs: Swagger UI en /docs", () => {
  it("apagado: /docs y sus hijos dan 404", async () => {
    delete process.env.DOCS_ENABLED;
    resetContainer();
    expect((await page()).status).toBe(404);
    expect((await document("chatbot.json")).status).toBe(404);
    expect((await asset("swagger-ui-bundle.js")).status).toBe(404);
    expect(
      (await getRedirect(new Request("http://localhost/docs/oauth2-redirect.html"))).status,
    ).toBe(404);
  });

  it("encendido: la pagina solo referencia /docs/assets y declara la CSP", async () => {
    enable();
    const response = await page();
    const html = await response.text();
    const outsideConfig = html.replace(/<script type="application\/json"[^>]*>[^<]*<\/script>/, "");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(outsideConfig).not.toMatch(/https?:\/\//);
    expect(outsideConfig).toContain("/docs/assets/swagger-ui-bundle.js");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/^default-src 'self'/);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      `connect-src 'self' ${new URL(TEST_OIDC.issuer).origin}`,
    );
    expect(docsConfig(html).clientId).toBe("chatbot-swagger");
  });

  it("sin simulador no se ofrece sim", async () => {
    enable(false);
    const urls = docsConfig(await (await page()).text()).urls.map((u) => u.url);
    expect(urls).toEqual(["/docs/openapi/chatbot.json", "/docs/openapi/platform.json"]);
    expect((await document("sim.json")).status).toBe(404);
  });

  it("con simulador se ofrece sim", async () => {
    enable(true);
    const urls = docsConfig(await (await page()).text()).urls.map((u) => u.url);
    expect(urls).toContain("/docs/openapi/sim.json");
    expect((await document("sim.json")).status).toBe(200);
  });

  it("el documento servido lleva el token endpoint del proveedor", async () => {
    enable();
    const response = await document("platform.json");
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(text).toContain(`${TEST_OIDC.issuer}/protocol/openid-connect/token`);
    expect(text).not.toContain("oidc.invalid");
  });

  it("un nombre sin .json o desconocido da 404", async () => {
    enable();
    expect((await document("chatbot")).status).toBe(404);
    expect((await document("nada.json")).status).toBe(404);
  });

  it("proveedor caido: 503 con envoltura", async () => {
    enable();
    setFakeIdpDown(true);
    const response = await document("chatbot.json");
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("identity_unavailable");
    expect(response.headers.get("X-Request-Id")).toBe(body.error.request_id);
  });

  it("activos: lista cerrada", async () => {
    enable();
    const bundle = await asset("swagger-ui-bundle.js");
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("Content-Type")).toMatch(/^text\/javascript/);
    expect((await asset("init.js")).status).toBe(200);
    expect((await asset("swagger-ui.css")).headers.get("Content-Type")).toMatch(/^text\/css/);
    for (const name of ["../package.json", "%2e%2e%2fpackage.json", "nada.js", "package.json"]) {
      expect((await asset(name)).status).toBe(404);
    }
  });

  it("la pagina de retorno OAuth2 carga su script del mismo origen", async () => {
    enable();
    const response = await getRedirect(new Request("http://localhost/docs/oauth2-redirect.html"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('src="/docs/assets/oauth2-redirect.js"');
    expect((await asset("oauth2-redirect.js")).status).toBe(200);
  });
});
