import { describe, expect, it } from "vitest";
import {
  addOrigin,
  removeOrigin,
  validateAllowedOrigins,
} from "@/modules/bot-config/domain/allowed-origins";
import {
  applyPatch,
  DEFAULT_TEXTS,
  EMPTY_OVERRIDES,
  effectiveConfig,
  PARAM_SPECS,
  parseBotConfigPatch,
  sanitizeOverrides,
  TEXT_PLACEHOLDERS,
} from "@/modules/bot-config/domain/bot-config";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { ValidationError } from "@/modules/shared/domain/validation-error";

const DEV = { allowLocalhost: true };
const PROD = { allowLocalhost: false };

describe("conocimiento-config: bot-config efectivo", () => {
  it("sin sobrescrituras devuelve los predeterminados", () => {
    const config = effectiveConfig(EMPTY_OVERRIDES);
    expect(config.texts.welcome).toEqual({ value: DEFAULT_TEXTS.welcome, overridden: false });
    expect(config.params).toEqual({
      widget_session_ttl_minutes: 30,
      widget_sessions_per_ip_per_minute: 10,
      widget_key_grace_hours: 24,
      kb_max_results: 3,
      request_hold_minutes: 240,
      max_pending_requests_per_patient: 2,
      verification_max_attempts: 3,
      verification_lock_minutes: 30,
    });
    expect(config.allowedOrigins).toEqual([]);
  });

  it("marca como sobrescrito lo que el tenant cambio", () => {
    const config = effectiveConfig({
      texts: { welcome: "Bienvenido a {clinic_name}" },
      params: { kb_max_results: 5 },
      allowedOrigins: [],
    });
    expect(config.texts.welcome).toEqual({ value: "Bienvenido a {clinic_name}", overridden: true });
    expect(config.texts.kb_see_more_label.overridden).toBe(false);
    expect(config.params.kb_max_results).toBe(5);
  });
});

describe("conocimiento-config: parche de bot-config", () => {
  it("aplica textos y params validos", () => {
    const next = applyPatch(
      EMPTY_OVERRIDES,
      { texts: { welcome: "Hola desde {clinic_name}" }, params: { widget_key_grace_hours: 0 } },
      DEV,
    );
    expect(next.texts).toEqual({ welcome: "Hola desde {clinic_name}" });
    expect(next.params).toEqual({ widget_key_grace_hours: 0 });
  });

  it("null devuelve el texto o el param al predeterminado", () => {
    const current = {
      texts: { welcome: "Hola" },
      params: { kb_max_results: 7 },
      allowedOrigins: [],
    };
    const next = applyPatch(
      current,
      { texts: { welcome: null }, params: { kb_max_results: null } },
      DEV,
    );
    expect(next.texts).toEqual({});
    expect(next.params).toEqual({});
  });

  it("lo que no viene en el parche no cambia", () => {
    const current = { texts: { welcome: "Hola" }, params: {}, allowedOrigins: ["https://a.test"] };
    expect(applyPatch(current, {}, DEV)).toEqual(current);
  });

  it.each([
    [{ texts: { despedida: "Chao" } }, "texts.despedida"],
    [{ texts: { welcome: "" } }, "texts.welcome"],
    [{ texts: { welcome: "x".repeat(1001) } }, "texts.welcome"],
    [{ texts: { welcome: "Hola {nombre}" } }, "texts.welcome"],
    [{ texts: { welcome: "<b>Hola</b>" } }, "texts.welcome"],
    [{ texts: { welcome: 5 } }, "texts.welcome"],
    [{ params: { kb_max_results: 11 } }, "params.kb_max_results"],
    [{ params: { widget_session_ttl_minutes: 4 } }, "params.widget_session_ttl_minutes"],
    [{ params: { kb_max_results: 2.5 } }, "params.kb_max_results"],
    [{ params: { desconocido: 1 } }, "params.desconocido"],
    [{ texts: ["welcome"] }, "texts"],
    [{ params: { request_hold_minutes: 14 } }, "params.request_hold_minutes"],
    [
      { params: { max_pending_requests_per_patient: 6 } },
      "params.max_pending_requests_per_patient",
    ],
  ])("rechaza %j", (patch, field) => {
    try {
      applyPatch(EMPTY_OVERRIDES, patch, DEV);
      expect.unreachable("deberia fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field });
    }
  });

  it("los rangos de los params coinciden con la spec", () => {
    expect(PARAM_SPECS.widget_key_grace_hours).toEqual({ default: 24, min: 0, max: 168 });
    expect(PARAM_SPECS.widget_sessions_per_ip_per_minute).toEqual({
      default: 10,
      min: 1,
      max: 100,
    });
    expect(PARAM_SPECS.request_hold_minutes).toEqual({ default: 240, min: 15, max: 4320 });
    expect(PARAM_SPECS.max_pending_requests_per_patient).toEqual({ default: 2, min: 1, max: 5 });
  });
});

describe("conocimiento-config: cuerpo HTTP del parche", () => {
  it("traduce allowed_origins y deja fuera lo ausente", () => {
    expect(parseBotConfigPatch({ allowed_origins: ["https://a.test"] })).toEqual({
      allowedOrigins: ["https://a.test"],
    });
  });

  it("rechaza campos desconocidos y cuerpos que no son objeto", () => {
    expect(() => parseBotConfigPatch({ colores: {} })).toThrow(ValidationError);
    expect(() => parseBotConfigPatch([])).toThrow(ValidationError);
    expect(() => parseBotConfigPatch(null)).toThrow(ValidationError);
  });
});

describe("conocimiento-config: origenes permitidos", () => {
  it("normaliza a minusculas y quita duplicados", () => {
    expect(validateAllowedOrigins(["https://Clinica.Test", "https://clinica.test"], PROD)).toEqual([
      "https://clinica.test",
    ]);
  });

  it("acepta puerto explicito", () => {
    expect(validateAllowedOrigins(["https://clinica.test:8443"], PROD)).toEqual([
      "https://clinica.test:8443",
    ]);
  });

  it("localhost solo fuera de produccion", () => {
    expect(validateAllowedOrigins(["http://localhost:3000"], DEV)).toEqual([
      "http://localhost:3000",
    ]);
    expect(() => validateAllowedOrigins(["http://localhost:3000"], PROD)).toThrow(ValidationError);
  });

  it.each([
    "http://clinica.test",
    "https://clinica.test/",
    "https://clinica.test/widget",
    "https://*.clinica.test",
    "clinica.test",
    "",
  ])("rechaza %s", (origin) => {
    expect(() => validateAllowedOrigins([origin], DEV)).toThrow(ValidationError);
  });

  it("rechaza mas de 20 origenes y valores que no son lista", () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://c${i}.test`);
    expect(() => validateAllowedOrigins(many, PROD)).toThrow(ValidationError);
    expect(() => validateAllowedOrigins("https://a.test", PROD)).toThrow(ValidationError);
  });
});

describe("conocimiento-config: lectura defensiva", () => {
  it("descarta claves desconocidas o valores fuera de rango guardados", () => {
    const overrides = sanitizeOverrides({
      texts: { welcome: "Hola", viejo: "x" },
      params: { kb_max_results: 99, widget_key_grace_hours: 12 },
      allowedOrigins: ["https://a.test"],
    });
    expect(overrides).toEqual({
      texts: { welcome: "Hola" },
      params: { widget_key_grace_hours: 12 },
      allowedOrigins: ["https://a.test"],
    });
  });
});

describe("conocimiento-config: textos del chat", () => {
  it("cada texto acepta {clinic_name} y solo los marcadores de su clave", () => {
    const ok = applyPatch(
      EMPTY_OVERRIDES,
      { texts: { verify_failed: "Quedan {remaining} en {clinic_name}" } },
      DEV,
    );
    expect(ok.texts.verify_failed).toBe("Quedan {remaining} en {clinic_name}");
    expect(() =>
      applyPatch(EMPTY_OVERRIDES, { texts: { welcome: "Quedan {remaining}" } }, DEV),
    ).toThrow(ValidationError);
  });

  it("los predeterminados solo usan marcadores admitidos para su clave", () => {
    for (const [key, value] of Object.entries(DEFAULT_TEXTS)) {
      const used = [...value.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
      const allowed = ["clinic_name", ...TEXT_PLACEHOLDERS[key as keyof typeof DEFAULT_TEXTS]];
      expect(
        used.filter((name) => !allowed.includes(name ?? "")),
        key,
      ).toEqual([]);
    }
  });

  it("los params de verificacion respetan su rango", () => {
    expect(() =>
      applyPatch(EMPTY_OVERRIDES, { params: { verification_max_attempts: 6 } }, DEV),
    ).toThrow(ValidationError);
    expect(
      applyPatch(EMPTY_OVERRIDES, { params: { verification_lock_minutes: 1440 } }, DEV).params,
    ).toEqual({ verification_lock_minutes: 1440 });
  });
});

describe("conocimiento-config: alta y baja de un origen", () => {
  it("agrega normalizado y sin duplicar", () => {
    expect(addOrigin(["https://a.test"], " HTTPS://B.test ", PROD)).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
    expect(addOrigin(["https://a.test"], "https://a.test", PROD)).toEqual(["https://a.test"]);
  });

  it("respeta el formato y el maximo de 20", () => {
    expect(() => addOrigin([], "http://a.test", PROD)).toThrow(ValidationError);
    const full = Array.from({ length: 20 }, (_, i) => `https://o${i}.test`);
    expect(() => addOrigin(full, "https://otro.test", PROD)).toThrow(ValidationError);
    expect(addOrigin(full, "https://o3.test", PROD)).toEqual(full);
  });

  it("quita uno; si no esta es not_found", () => {
    expect(removeOrigin(["https://a.test", "https://b.test"], "https://A.test")).toEqual([
      "https://b.test",
    ]);
    expect(() => removeOrigin(["https://a.test"], "https://x.test")).toThrow(NotFoundError);
  });
});
