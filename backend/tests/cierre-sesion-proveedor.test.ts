import { describe, expect, it } from "vitest";
import { createCloseProviderSession } from "@/modules/auth/application/close-provider-session";
import { IdentityUnavailableError } from "@/modules/auth/domain/machine-credential-error";
import type { ClosedSessions } from "@/modules/auth/domain/ports/closed-sessions";
import { InvalidRequestError } from "@/modules/shared/domain/invalid-request-error";

const NOW = new Date("2026-10-27T10:00:00Z");

function setup(verifyLogout: () => Promise<{ providerSessionId: string }>) {
  const closes: Array<{ sid: string; until: Date }> = [];
  const closedSessions: ClosedSessions = {
    close: async (sid, until) => {
      closes.push({ sid, until });
    },
    isClosed: async () => false,
  };
  const close = createCloseProviderSession({
    verifier: { verifyLogout },
    closedSessions,
    clock: { now: () => NOW },
    maxTokenLifetimeSeconds: 300,
    clockToleranceSeconds: 30,
  });
  return { close, closes };
}

// Back-channel logout: ventana de cierre y clasificacion de errores.
describe("backchannel-logout: cierre de sesion del proveedor", () => {
  it("cierra hasta now + vida maxima + tolerancia de reloj", async () => {
    const { close, closes } = setup(async () => ({ providerSessionId: "sid-1" }));
    await close("logout-token");
    expect(closes).toEqual([{ sid: "sid-1", until: new Date(NOW.getTime() + 330_000) }]);
  });

  it("un logout_token invalido es invalid_request", async () => {
    const { close, closes } = setup(async () => {
      throw new Error("firma");
    });
    await expect(close("logout-token")).rejects.toBeInstanceOf(InvalidRequestError);
    expect(closes).toEqual([]);
  });

  it("un proveedor inalcanzable no se disfraza de invalid_request", async () => {
    const { close } = setup(async () => {
      throw new IdentityUnavailableError();
    });
    await expect(close("logout-token")).rejects.toBeInstanceOf(IdentityUnavailableError);
  });
});
