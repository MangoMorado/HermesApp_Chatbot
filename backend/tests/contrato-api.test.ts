import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { GET as getIdentity } from "@/app/api/v1/me/route";
import { ERROR_CODES } from "@/http/error-codes";
import { errorResponse, toApiError } from "@/http/errors";
import { buildOpenApiDocument } from "@/http/openapi";
import { buildSimOpenApiDocument } from "@/http/openapi-sim";
import { REQUEST_ID_HEADER } from "@/http/request-id";
import { createCheckHealth } from "@/modules/health/application/check-health";
import { RateLimitedError } from "@/modules/shared/domain/rate-limited-error";
import { signToken } from "./helpers/token";

const API_DIR = join(process.cwd(), "src", "app", "api", "v1");
const SIM_DIR = join(process.cwd(), "src", "app", "api", "sim", "v1");

/** Normaliza `[id]` de App Router a `{id}` de OpenAPI. */
function normalizePath(path: string): string {
  return path.replace(/\[([^\]]+)\]/g, "{$1}");
}

function declaredRoutes(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return declaredRoutes(full, root);
    }
    if (entry !== "route.ts") {
      return [];
    }
    const segments = relative(root, join(full, "..")).split(sep).filter(Boolean);
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

  it("openapi-sim.json esta al dia con el generador", () => {
    const onDisk = readFileSync(join(process.cwd(), "openapi-sim.json"), "utf8");

    expect(JSON.parse(onDisk)).toEqual(buildSimOpenApiDocument());
  });

  it("toda ruta de /api/v1 esta declarada en el contrato", () => {
    const document = buildOpenApiDocument() as { paths: Record<string, unknown> };
    const declared = Object.keys(document.paths).map(normalizePath).sort();
    const onDisk = declaredRoutes(API_DIR).map(normalizePath).sort();

    expect(onDisk).toEqual(declared);
  });

  it("toda ruta de /api/sim/v1 esta declarada en el contrato sim", () => {
    const document = buildSimOpenApiDocument() as { paths: Record<string, unknown> };
    const declared = Object.keys(document.paths).map(normalizePath).sort();
    const onDisk = declaredRoutes(SIM_DIR).map(normalizePath).sort();

    expect(onDisk).toEqual(declared);
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

describe("contrato-api: rate_limited", () => {
  it("responde 429 con Retry-After y el mismo valor en details", async () => {
    const response = errorResponse(toApiError(new RateLimitedError(17)), "peticion-rl");
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(body.error).toMatchObject({
      code: "rate_limited",
      request_id: "peticion-rl",
      details: { retry_after_seconds: 17 },
    });
  });

  it("otros errores no llevan Retry-After", () => {
    const response = errorResponse(toApiError(new Error("x")), "peticion-500");
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
