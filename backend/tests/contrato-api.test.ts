import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { ERROR_CODES } from "@/http/error-codes";
import { buildOpenApiDocument } from "@/http/openapi";
import { REQUEST_ID_HEADER } from "@/http/request-id";
import { createCheckHealth } from "@/modules/health/application/check-health";
import { signToken } from "./helpers/token";

const API_DIR = join(process.cwd(), "src", "app", "api", "v1");

function declaredRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return declaredRoutes(full);
    }
    if (entry !== "route.ts") {
      return [];
    }
    const segments = relative(API_DIR, join(full, "..")).split(sep).filter(Boolean);
    return [`/${segments.join("/")}`];
  });
}

describe("contrato-api: health", () => {
  it("reporta ok con el instante que entrega el puerto de reloj", () => {
    const fixed = new Date("2026-01-15T10:00:00.000Z");
    const checkHealth = createCheckHealth({ now: () => fixed });

    expect(checkHealth()).toEqual({ status: "ok", checkedAt: "2026-01-15T10:00:00.000Z" });
  });

  it("responde 200 sin exigir token", async () => {
    const response = await getHealth(new Request("http://localhost/api/v1/health"));

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});

describe("contrato-api: X-Request-Id", () => {
  it("devuelve el identificador que manda el cliente", async () => {
    const request = new Request("http://localhost/api/v1/health", {
      headers: { [REQUEST_ID_HEADER]: "peticion-123" },
    });
    const response = await getHealth(request);

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("peticion-123");
  });

  it("genera uno cuando el cliente no lo manda", async () => {
    const response = await getHealth(new Request("http://localhost/api/v1/health"));

    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("descarta un identificador desmedido y genera el suyo", async () => {
    const request = new Request("http://localhost/api/v1/health", {
      headers: { [REQUEST_ID_HEADER]: "x".repeat(500) },
    });
    const response = await getHealth(request);

    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("el identificador del cuerpo del error coincide con el de la cabecera", async () => {
    const request = new Request("http://localhost/api/v1/me", {
      headers: { [REQUEST_ID_HEADER]: "peticion-abc" },
    });
    const response = await getIdentity(request);
    const body = await response.json();

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("peticion-abc");
    expect(body.error.request_id).toBe("peticion-abc");
  });
});

describe("contrato-api: envoltura de errores", () => {
  it("todo error trae code, message y request_id", async () => {
    const response = await getIdentity(new Request("http://localhost/api/v1/me"));
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error).toEqual({
      code: expect.any(String),
      message: expect.any(String),
      request_id: expect.any(String),
    });
    expect(ERROR_CODES).toContain(body.error.code);
  });
});

describe("contrato-api: OpenAPI", () => {
  it("openapi.json esta al dia con el generador", () => {
    const onDisk = readFileSync(join(process.cwd(), "openapi.json"), "utf8");

    expect(JSON.parse(onDisk)).toEqual(buildOpenApiDocument());
  });

  it("toda ruta de /api/v1 esta declarada en el contrato", () => {
    const document = buildOpenApiDocument() as { paths: Record<string, unknown> };
    const declared = Object.keys(document.paths).sort();

    expect(declaredRoutes(API_DIR).sort()).toEqual(declared);
  });

  it("las respuestas de error referencian el mismo esquema", async () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    const identity = document.paths["/me"]?.get;
    const token = await signToken({ role: "operator", tenantId: "tenant-a" });
    const response = await getIdentity(
      new Request("http://localhost/api/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(Object.keys(identity?.responses ?? {})).toContain("401");
  });
});
