import { describe, expect, it } from "vitest";
import { parseTenantDraft } from "@/modules/platform/domain/tenant-registration";
import { parseTokenRequest } from "@/modules/platform/domain/token-request";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("alta-chatbot: peticion de token de plataforma", () => {
  it("aplica el TTL por defecto de cada rol", () => {
    expect(parseTokenRequest({ tenant_id: "t", role: "admin", subject: "ana" })).toEqual({
      tenantId: "t",
      role: "admin",
      subject: "ana",
      ttlMinutes: 480,
    });
    expect(
      parseTokenRequest({ tenant_id: "t", role: "service", subject: "hermes" }).ttlMinutes,
    ).toBe(60);
  });

  it("acepta un TTL dentro del tope", () => {
    expect(
      parseTokenRequest({ tenant_id: "t", role: "service", subject: "h", ttl_minutes: 1440 })
        .ttlMinutes,
    ).toBe(1440);
  });

  it.each([
    [{ tenant_id: "t", role: "widget", subject: "x" }, "role"],
    [{ tenant_id: "t", role: "root", subject: "x" }, "role"],
    [{ tenant_id: "", role: "admin", subject: "x" }, "tenant_id"],
    [{ tenant_id: "t", role: "admin", subject: "" }, "subject"],
    [{ tenant_id: "t", role: "admin", subject: "widget:abc" }, "subject"],
    [{ tenant_id: "t", role: "admin", subject: "x".repeat(121) }, "subject"],
    [{ tenant_id: "t", role: "operator", subject: "x", ttl_minutes: 721 }, "ttl_minutes"],
    [{ tenant_id: "t", role: "operator", subject: "x", ttl_minutes: 0 }, "ttl_minutes"],
    [{ tenant_id: "t", role: "operator", subject: "x", ttl_minutes: 1.5 }, "ttl_minutes"],
  ])("rechaza %j", (raw, field) => {
    try {
      parseTokenRequest(raw);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });
});

describe("alta-chatbot: borrador de tenant", () => {
  it("acepta slug y nombre; los origenes se validan al aprovisionar", () => {
    expect(parseTenantDraft({ slug: "clinica-norte", name: "Clínica Norte" })).toEqual({
      slug: "clinica-norte",
      name: "Clínica Norte",
      allowedOrigins: [],
    });
  });

  it.each(["", "Clinica", "-norte", "norte-", "norte_1", "x".repeat(51)])(
    "rechaza el slug %j",
    (slug) => {
      expect(() => parseTenantDraft({ slug, name: "N" })).toThrow(ValidationError);
    },
  );

  it("exige nombre", () => {
    expect(() => parseTenantDraft({ slug: "norte" })).toThrow(ValidationError);
  });
});
