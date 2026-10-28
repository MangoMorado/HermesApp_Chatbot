import { describe, expect, it } from "vitest";
import { parseTenantDraft } from "@/modules/platform/domain/tenant-registration";
import { parseWidgetClient } from "@/modules/platform/domain/widget-client";
import { ValidationError } from "@/modules/shared/domain/validation-error";

describe("alta-chatbot: credenciales de widget", () => {
  it("acepta client_id y client_secret", () => {
    expect(parseWidgetClient({ client_id: "widget-a", client_secret: "s3cr3t" })).toEqual({
      clientId: "widget-a",
      clientSecret: "s3cr3t",
    });
  });

  it("recorta los espacios de client_id y client_secret", () => {
    expect(parseWidgetClient({ client_id: "  widget-a\n", client_secret: "\ts3cr3t " })).toEqual({
      clientId: "widget-a",
      clientSecret: "s3cr3t",
    });
  });

  it("acepta el tope de 200 caracteres", () => {
    const max = "x".repeat(200);
    expect(parseWidgetClient({ client_id: max, client_secret: max }).clientSecret).toBe(max);
  });

  it.each([
    [null, "body"],
    [{ client_secret: "s" }, "client_id"],
    [{ client_id: "", client_secret: "s" }, "client_id"],
    [{ client_id: 5, client_secret: "s" }, "client_id"],
    [{ client_id: "x".repeat(201), client_secret: "s" }, "client_id"],
    [{ client_id: "w" }, "client_secret"],
    [{ client_id: "w", client_secret: "" }, "client_secret"],
    [{ client_id: "   ", client_secret: "s" }, "client_id"],
    [{ client_id: "w", client_secret: " \t\n" }, "client_secret"],
    [{ client_id: "w", client_secret: "x".repeat(201) }, "client_secret"],
  ])("rechaza %j", (raw, field) => {
    try {
      parseWidgetClient(raw);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });

  it("no revela el secreto en el mensaje de error", () => {
    try {
      parseWidgetClient({ client_id: "w", client_secret: "x".repeat(201) });
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("xxxxxxxxxx");
      expect((error as Error).message).not.toContain("xxxxxxxxxx");
    }
  });
});

describe("alta-chatbot: borrador de tenant", () => {
  it("acepta slug y nombre; los origenes se validan al aprovisionar", () => {
    expect(parseTenantDraft({ slug: "clinica-norte", name: "Clínica Norte" })).toEqual({
      slug: "clinica-norte",
      name: "Clínica Norte",
      allowedOrigins: [],
      widgetClient: null,
    });
  });

  it("incluye widget_client cuando viene", () => {
    expect(
      parseTenantDraft({
        slug: "norte",
        name: "N",
        widget_client: { client_id: "widget-n", client_secret: "s" },
      }).widgetClient,
    ).toEqual({ clientId: "widget-n", clientSecret: "s" });
  });

  it("rechaza un widget_client incompleto", () => {
    expect(() => parseTenantDraft({ slug: "norte", name: "N", widget_client: {} })).toThrow(
      ValidationError,
    );
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
