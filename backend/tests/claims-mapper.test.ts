import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/config/env";
import { mapClaims } from "@/modules/auth/infrastructure/claims-mapper";

type Settings = Parameters<typeof mapClaims>[1];
const base: Settings = {
  tenantClaim: { segments: ["tenant_id"], pick: "value" },
  rolesClaim: ["roles"],
  roleMap: new Map(),
};
const singleElement: Settings = {
  ...base,
  tenantClaim: { segments: ["organization"], pick: "single-element" },
};
const singleKey: Settings = {
  ...base,
  tenantClaim: { segments: ["organization"], pick: "single-key" },
};
const roleMap: AppConfig["oidc"]["roleMap"] = new Map([["clinic-staff", "operator"]]);

describe("claims-mapper", () => {
  it("contrato por defecto", () =>
    expect(mapClaims({ sub: "u", tenant_id: "t", roles: ["operator"], sid: "s1" }, base)).toEqual({
      subject: "u",
      role: "operator",
      tenantId: "t",
      providerSessionId: "s1",
    }));

  it("ignora roles desconocidos", () =>
    expect(
      mapClaims(
        { sub: "u", tenant_id: "t", roles: ["offline_access", "default-roles-x", "admin"] },
        base,
      ).role,
    ).toBe("admin"));

  it("cero roles lanza", () =>
    expect(() => mapClaims({ sub: "u", tenant_id: "t", roles: ["x"] }, base)).toThrow());

  it("dos roles lanza", () =>
    expect(() =>
      mapClaims({ sub: "u", tenant_id: "t", roles: ["admin", "operator"] }, base),
    ).toThrow());

  it("role map", () =>
    expect(
      mapClaims({ sub: "u", tenant_id: "t", roles: ["clinic-staff"] }, { ...base, roleMap }).role,
    ).toBe("operator"));

  it("ruta anidada de roles", () =>
    expect(
      mapClaims(
        { sub: "u", tenant_id: "t", realm_access: { roles: ["service"] } },
        { ...base, rolesClaim: ["realm_access", "roles"] },
      ).role,
    ).toBe("service"));

  it.each([[123], [null], [{}], [""], [undefined]])("tenant no string (%j) lanza", (v) =>
    expect(() => mapClaims({ sub: "u", tenant_id: v, roles: ["admin"] }, base)).toThrow(),
  );

  it("single-element", () =>
    expect(
      mapClaims({ sub: "u", organization: ["clinica-x"], roles: ["admin"] }, singleElement)
        .tenantId,
    ).toBe("clinica-x"));

  it.each([[[]], [["a", "b"]], [[1]]])("single-element invalido %j", (v) =>
    expect(() =>
      mapClaims({ sub: "u", organization: v, roles: ["admin"] }, singleElement),
    ).toThrow(),
  );

  it("single-key", () =>
    expect(
      mapClaims(
        { sub: "u", organization: { "clinica-x": { id: "9" } }, roles: ["admin"] },
        singleKey,
      ).tenantId,
    ).toBe("clinica-x"));

  it.each([[{}], [{ a: 1, b: 2 }], [["a"]]])("single-key invalido %j", (v) =>
    expect(() => mapClaims({ sub: "u", organization: v, roles: ["admin"] }, singleKey)).toThrow(),
  );

  it("platform sin tenant", () =>
    expect(mapClaims({ sub: "p", roles: ["platform"] }, base)).toEqual({
      subject: "p",
      role: "platform",
      tenantId: null,
    }));

  it("platform con tenant lo ignora", () =>
    expect(mapClaims({ sub: "p", tenant_id: "t", roles: ["platform"] }, base).tenantId).toBeNull());

  it("sin sub lanza", () =>
    expect(() => mapClaims({ tenant_id: "t", roles: ["admin"] }, base)).toThrow());
});
