import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER, idempotent, settleIdempotencyKey } from "@/lib/idempotency";

function keyOf(init: RequestInit): string {
  return new Headers(init.headers).get(IDEMPOTENCY_HEADER) ?? "";
}

describe("idempotencia en el cliente", () => {
  it("el mismo envío repetido reutiliza la clave hasta que tiene éxito", () => {
    const first = keyOf(idempotent("practitioner.create", { name: "A" }));
    const retry = keyOf(idempotent("practitioner.create", { name: "A" }));
    expect(retry).toBe(first);

    settleIdempotencyKey(first);
    expect(keyOf(idempotent("practitioner.create", { name: "A" }))).not.toBe(first);
  });

  it("otro cuerpo u otra operación usan otra clave", () => {
    const base = keyOf(idempotent("practitioner.delete:1", {}));
    expect(keyOf(idempotent("service.delete:1", {}))).not.toBe(base);
    expect(keyOf(idempotent("practitioner.delete:2", {}))).not.toBe(base);
  });
});
