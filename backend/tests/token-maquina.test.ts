import { describe, expect, it } from "vitest";
import { createMachineTokenCheck } from "@/modules/auth/application/machine-token-check";
import {
  IdentityUnavailableError,
  MachineCredentialMismatchError,
  MachineCredentialMissingError,
} from "@/modules/auth/domain/machine-credential-error";
import type { TokenClaims } from "@/modules/auth/domain/ports/token-verifier";

const token = { accessToken: "x", expiresAt: new Date("2026-10-27T10:05:00Z") };
const ref = { kind: "widget", tenantId: "t1" } as const;

function checkWith(verify: () => Promise<TokenClaims>) {
  return createMachineTokenCheck({ verify });
}

// Un token de cliente maquina solo se entrega si verifica con el rol y la clinica pedidos.
describe("alta-chatbot: token de cliente maquina", () => {
  it("widget de la clinica pedida pasa", async () => {
    const check = checkWith(async () => ({ subject: "s", role: "widget", tenantId: "t1" }));
    await expect(check(token, ref)).resolves.toBeUndefined();
  });

  it.each<[string, TokenClaims]>([
    ["rol service", { subject: "s", role: "service", tenantId: "t1" }],
    ["otra clinica", { subject: "s", role: "widget", tenantId: "t2" }],
    ["platform sin tenant", { subject: "s", role: "platform", tenantId: null }],
  ])("%s -> credenciales no configuradas", async (_, claims) => {
    const error = await checkWith(async () => claims)(token, ref).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MachineCredentialMismatchError);
    expect(error).toBeInstanceOf(MachineCredentialMissingError);
  });

  it("un token que no verifica -> credenciales no configuradas", async () => {
    const check = checkWith(async () => {
      throw new Error("firma");
    });
    await expect(check(token, ref)).rejects.toBeInstanceOf(MachineCredentialMismatchError);
  });

  it("proveedor inalcanzable -> IdentityUnavailableError", async () => {
    const check = checkWith(async () => {
      throw new IdentityUnavailableError();
    });
    await expect(check(token, ref)).rejects.toBeInstanceOf(IdentityUnavailableError);
  });
});
