import { describe, expect, it } from "vitest";
import { CHATBOT_PANEL_CASES } from "./contrato-rutas/cases-chatbot-panel";
import { CHATBOT_WIDGET_CASES } from "./contrato-rutas/cases-chatbot-widget";
import { coverageGaps } from "./contrato-rutas/coverage";
import { contractDocument, declaredOperations } from "./contrato-rutas/documents";
import { EXEMPTIONS } from "./contrato-rutas/exemptions";
import { CHECKED_STATUSES, type Surface } from "./contrato-rutas/types";
import { createContractValidator } from "./contrato-rutas/validator";

const SURFACES: readonly Surface[] = ["chatbot", "platform", "sim"];

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "r",
      ...headers,
    },
  });
}

const ERROR = {
  error: { code: "unauthorized", message: "m", request_id: "r" },
};

describe("contrato-rutas: validador", () => {
  const validator = createContractValidator("chatbot");
  const me = { method: "get", path: "/me" } as const;

  it("el validador rechaza un status no declarado", async () => {
    await expect(validator.check({ ...me, status: 418 }, jsonResponse({}, 418))).rejects.toThrow(
      /418/,
    );
  });

  it("el validador rechaza un status distinto del esperado", async () => {
    await expect(validator.check({ ...me, status: 200 }, jsonResponse(ERROR, 401))).rejects.toThrow(
      /401/,
    );
  });

  it("el validador rechaza un 404 con cuerpo de exito", async () => {
    const body = { id: "x", category: "c", question: "q", answer: "a" };
    const entry = { method: "get", path: "/knowledge-entries/{id}" } as const;
    await expect(
      validator.check({ ...entry, status: 404 }, jsonResponse(body, 404)),
    ).rejects.toThrow(/cuerpo/);
  });

  it("el validador rechaza otro Content-Type", async () => {
    const response = new Response(JSON.stringify(ERROR), {
      status: 401,
      headers: { "Content-Type": "text/plain", "X-Request-Id": "r" },
    });
    await expect(validator.check({ ...me, status: 401 }, response)).rejects.toThrow(/Content-Type/);
  });

  it("el validador rechaza sin X-Request-Id", async () => {
    const response = new Response(JSON.stringify(ERROR), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    await expect(validator.check({ ...me, status: 401 }, response)).rejects.toThrow(/X-Request-Id/);
  });

  it("el validador acepta un error bien formado", async () => {
    await expect(
      validator.check({ ...me, status: 401 }, jsonResponse(ERROR, 401)),
    ).resolves.toBeUndefined();
  });

  it("el validador resuelve $ref anidados", async () => {
    const body = { subject: "s", tenant_id: "t", role: "nada" };
    await expect(validator.check({ ...me, status: 200 }, jsonResponse(body, 200))).rejects.toThrow(
      /cuerpo/,
    );
  });
});

describe("contrato-rutas: errores comunes y exenciones", () => {
  it("500 y 503 referencian el esquema comun", () => {
    for (const surface of SURFACES) {
      for (const operation of declaredOperations(surface)) {
        for (const status of ["500", "503"]) {
          const response = operation.responses[status] as
            | { content?: Record<string, { schema?: unknown }> }
            | undefined;
          if (response) {
            expect(response.content?.["application/json"]?.schema, operation.key).toEqual({
              $ref: "#/components/schemas/Error",
            });
          }
        }
      }
    }
  });

  it("cada exencion lleva motivo y apunta a una operacion y status declarados", () => {
    for (const [key, statuses] of Object.entries(EXEMPTIONS)) {
      const [surface, method, path] = key.split(" ") as [Surface, string, string];
      const operation = declaredOperations(surface).find(
        (op) => op.method.toUpperCase() === method && op.path === path,
      );
      expect(operation, key).toBeDefined();
      for (const [status, reason] of Object.entries(statuses)) {
        expect(reason, `${key} ${status}`).toMatch(/\S/);
        expect(Object.keys(operation?.responses ?? {}), `${key} ${status}`).toContain(status);
        expect(CHECKED_STATUSES.map(String)).toContain(status);
      }
    }
  });

  it("los documentos salen de los builders", () => {
    expect(Object.keys(contractDocument("sim").paths).length).toBeGreaterThan(0);
  });
});

describe("contrato-rutas: cobertura", () => {
  it("toda operacion del chatbot tiene sus casos o exenciones", () => {
    expect(coverageGaps("chatbot", [...CHATBOT_PANEL_CASES, ...CHATBOT_WIDGET_CASES])).toEqual([]);
  });
});
