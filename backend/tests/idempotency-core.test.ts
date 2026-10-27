import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { IdempotencyKeyTakenError } from "@/modules/shared/domain/idempotency";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const withWriteTransaction = vi.fn();

vi.mock("@/composition-root", () => ({
  getContainer: () => ({ withWriteTransaction }),
}));

import {
  idempotentJson,
  parseJsonBody,
  platformScope,
  readIdempotentRequest,
  runIdempotent,
  tenantScope,
} from "@/http/idempotency-core";

function request(query: string, key = "same-key", body = '{"resourceType":"Patient"}'): Request {
  return new Request(`http://localhost/fhir/Patient?identifier=${query}`, {
    method: "PUT",
    headers: { "Idempotency-Key": key },
    body,
  });
}

describe("idempotencia HTTP", () => {
  beforeEach(() => {
    withWriteTransaction.mockReset();
  });

  it("incluye la query en path y hash cuando se solicita pathname+search", async () => {
    const first = await readIdempotentRequest(
      request("urn:test|one"),
      "hermes",
      1,
      undefined,
      "pathname+search",
    );
    const second = await readIdempotentRequest(
      request("urn:test|two"),
      "hermes",
      1,
      undefined,
      "pathname+search",
    );

    expect(first.path).toBe("/fhir/Patient?identifier=urn:test|one");
    expect(second.path).toBe("/fhir/Patient?identifier=urn:test|two");
    expect(first.hash).not.toBe(second.hash);
  });

  it("mantiene pathname como valor predeterminado para REST", async () => {
    const result = await readIdempotentRequest(request("urn:test|one"), "operator");

    expect(result.path).toBe("/fhir/Patient");
  });

  it("rechaza clave ausente o corta y JSON invalido", async () => {
    await expect(
      readIdempotentRequest(
        new Request("http://localhost/x", { method: "POST", body: "{}" }),
        "op",
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      readIdempotentRequest(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "Idempotency-Key": "ab" },
          body: "{}",
        }),
        "op",
        8,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(() => parseJsonBody("{")).toThrow(ValidationError);
    expect(parseJsonBody("")).toBeNull();
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
  });

  it("usa HMAC cuando hay hashKey", async () => {
    const plain = await readIdempotentRequest(request("urn:test|one"), "op");
    const keyed = await readIdempotentRequest(request("urn:test|one"), "op", 1, "secret");
    expect(keyed.hash).not.toBe(plain.hash);
  });

  it("tenantScope y platformScope delegan find/reserve/complete", async () => {
    const tenantId = toTenantId("t1");
    const store = {
      find: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
    };
    const scoped = tenantScope(store, tenantId);
    await scoped.find("k");
    await scoped.reserve({
      key: "k",
      actorSubject: "a",
      method: "POST",
      path: "/x",
      requestHash: "h",
      createdAt: new Date(),
    });
    await scoped.complete("k", 201, { ok: true });
    expect(store.find).toHaveBeenCalledWith(tenantId, "k");
    expect(store.save).toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledWith(tenantId, "k", 201, { ok: true });

    const platform = {
      find: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
    };
    const pScoped = platformScope(platform);
    await pScoped.reserve({
      key: "k",
      actorSubject: "a",
      method: "POST",
      path: "/x",
      requestHash: "h",
      createdAt: new Date(),
    });
    expect(platform.save).toHaveBeenCalled();
  });

  it("runIdempotent repite respuesta previa o ejecuta la escritura", async () => {
    const outside = {
      find: vi.fn(async () => ({
        requestHash: "same",
        responseStatus: 201,
        responseBody: { id: "1" },
      })),
      reserve: vi.fn(),
      complete: vi.fn(),
    };
    const req = await readIdempotentRequest(request("urn:test|one"), "op");
    // fuerza hash conocido
    const planRequest = { ...req, hash: "same" };
    await expect(
      runIdempotent({
        request: planRequest,
        outside,
        inside: () => outside,
        execute: async () => ({ status: 201, body: { id: "1" } }),
      }),
    ).resolves.toEqual({ status: 201, body: { id: "1" } });
    expect(withWriteTransaction).not.toHaveBeenCalled();

    outside.find.mockResolvedValue(null);
    withWriteTransaction.mockImplementation(async (fn) =>
      fn({ clock: { now: () => new Date("2026-01-01T00:00:00.000Z") } }),
    );
    const insideStore = {
      find: vi.fn(async () => null),
      reserve: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
    };
    await expect(
      runIdempotent({
        request: planRequest,
        outside,
        inside: () => insideStore,
        execute: async () => ({ status: 201, body: { id: "2" }, stored: { session_id: "s" } }),
      }),
    ).resolves.toEqual({ status: 201, body: { id: "2" } });
    expect(insideStore.complete).toHaveBeenCalledWith("same-key", 201, { session_id: "s" });
  });

  it("runIdempotent choca si la clave se reutiliza con otro cuerpo", async () => {
    const outside = {
      find: vi.fn(async () => ({
        requestHash: "otro",
        responseStatus: 201,
        responseBody: {},
      })),
      reserve: vi.fn(),
      complete: vi.fn(),
    };
    const req = await readIdempotentRequest(request("urn:test|one"), "op");
    await expect(
      runIdempotent({
        request: req,
        outside,
        inside: () => outside,
        execute: async () => ({ status: 201, body: {} }),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("runIdempotent repite tras carrera IdempotencyKeyTakenError", async () => {
    const outside = {
      find: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          requestHash: "h",
          responseStatus: 200,
          responseBody: { ok: true },
        }),
      reserve: vi.fn(),
      complete: vi.fn(),
    };
    withWriteTransaction.mockRejectedValue(new IdempotencyKeyTakenError());
    const req = await readIdempotentRequest(request("urn:test|one"), "op");
    await expect(
      runIdempotent({
        request: { ...req, hash: "h" },
        outside,
        inside: () => outside,
        execute: async () => ({ status: 200, body: { ok: true } }),
      }),
    ).resolves.toEqual({ status: 200, body: { ok: true } });
  });

  it("idempotentJson incluye X-Request-Id", () => {
    const response = idempotentJson({ status: 201, body: { a: 1 } }, "req-xyz");
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-Id")).toBe("req-xyz");
  });
});
