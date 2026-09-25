import { asRecord, isRecord } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { type OriginPolicy, validateAllowedOrigins } from "./allowed-origins";

/** Textos del bot. Los predeterminados viven aqui; el tenant solo guarda los que sobrescribe. */
export const DEFAULT_TEXTS = {
  welcome: "Hola, soy el asistente virtual de {clinic_name}. ¿En qué te puedo ayudar?",
  kb_see_more_label: "Ver más",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

export const PARAM_SPECS = {
  widget_session_ttl_minutes: { default: 30, min: 5, max: 120 },
  widget_sessions_per_ip_per_minute: { default: 10, min: 1, max: 100 },
  widget_key_grace_hours: { default: 24, min: 0, max: 168 },
  kb_max_results: { default: 3, min: 1, max: 10 },
  request_hold_minutes: { default: 240, min: 15, max: 4320 },
  max_pending_requests_per_patient: { default: 2, min: 1, max: 5 },
} as const;

export type ParamKey = keyof typeof PARAM_SPECS;
export type BotParams = Readonly<Record<ParamKey, number>>;

export type BotConfigOverrides = {
  readonly texts: Readonly<Partial<Record<TextKey, string>>>;
  readonly params: Readonly<Partial<BotParams>>;
  readonly allowedOrigins: readonly string[];
};

export type EffectiveText = { readonly value: string; readonly overridden: boolean };

export type EffectiveBotConfig = {
  readonly texts: Readonly<Record<TextKey, EffectiveText>>;
  readonly params: BotParams;
  readonly allowedOrigins: readonly string[];
};

/** Parche ya desempaquetado del cuerpo HTTP; los valores se validan al aplicarlo. */
export type BotConfigPatch = {
  readonly texts?: unknown;
  readonly params?: unknown;
  readonly allowedOrigins?: unknown;
};

export const EMPTY_OVERRIDES: BotConfigOverrides = { texts: {}, params: {}, allowedOrigins: [] };

const TEXT_MAX_LENGTH = 1000;
const ALLOWED_PLACEHOLDERS = new Set(["clinic_name"]);
const PLACEHOLDER = /\{([^{}]*)\}/g;
const PATCH_FIELDS = new Set(["texts", "params", "allowed_origins"]);

const TEXT_KEYS = Object.keys(DEFAULT_TEXTS) as TextKey[];
const PARAM_KEYS = Object.keys(PARAM_SPECS) as ParamKey[];

function isTextKey(key: string): key is TextKey {
  return Object.hasOwn(DEFAULT_TEXTS, key);
}

function isParamKey(key: string): key is ParamKey {
  return Object.hasOwn(PARAM_SPECS, key);
}

export function effectiveConfig(overrides: BotConfigOverrides): EffectiveBotConfig {
  const texts = Object.fromEntries(
    TEXT_KEYS.map((key) => {
      const own = overrides.texts[key];
      return [key, { value: own ?? DEFAULT_TEXTS[key], overridden: own !== undefined }];
    }),
  ) as Record<TextKey, EffectiveText>;
  const params = Object.fromEntries(
    PARAM_KEYS.map((key) => [key, overrides.params[key] ?? PARAM_SPECS[key].default]),
  ) as Record<ParamKey, number>;
  return { texts, params, allowedOrigins: overrides.allowedOrigins };
}

export function parseBotConfigPatch(raw: unknown): BotConfigPatch {
  const data = asRecord(raw, "body");
  const unknown = Object.keys(data).find((key) => !PATCH_FIELDS.has(key));
  if (unknown !== undefined) {
    throw new ValidationError(`Campo desconocido: ${unknown}`, { field: unknown });
  }
  return {
    ...(Object.hasOwn(data, "texts") ? { texts: data.texts } : {}),
    ...(Object.hasOwn(data, "params") ? { params: data.params } : {}),
    ...(Object.hasOwn(data, "allowed_origins") ? { allowedOrigins: data.allowed_origins } : {}),
  };
}

export function applyPatch(
  current: BotConfigOverrides,
  patch: BotConfigPatch,
  policy: OriginPolicy,
): BotConfigOverrides {
  return {
    texts: patch.texts === undefined ? current.texts : patchTexts(current.texts, patch.texts),
    params: patch.params === undefined ? current.params : patchParams(current.params, patch.params),
    allowedOrigins:
      patch.allowedOrigins === undefined
        ? current.allowedOrigins
        : validateAllowedOrigins(patch.allowedOrigins, policy),
  };
}

/** Lectura desde la base: descarta lo que ya no es valido en vez de fallar. */
export function sanitizeOverrides(raw: {
  texts: unknown;
  params: unknown;
  allowedOrigins: readonly string[];
}): BotConfigOverrides {
  const texts: Partial<Record<TextKey, string>> = {};
  for (const [key, value] of Object.entries(isRecord(raw.texts) ? raw.texts : {})) {
    if (isTextKey(key) && isValid(() => validateText(key, value))) {
      texts[key] = value as string;
    }
  }
  const params: Partial<Record<ParamKey, number>> = {};
  for (const [key, value] of Object.entries(isRecord(raw.params) ? raw.params : {})) {
    if (isParamKey(key) && isValid(() => validateParam(key, value))) {
      params[key] = value as number;
    }
  }
  return { texts, params, allowedOrigins: raw.allowedOrigins };
}

function patchTexts(current: BotConfigOverrides["texts"], raw: unknown) {
  const next: Partial<Record<TextKey, string>> = { ...current };
  for (const [key, value] of Object.entries(asRecord(raw, "texts"))) {
    if (!isTextKey(key)) {
      throw new ValidationError(`Texto desconocido: ${key}`, { field: `texts.${key}` });
    }
    if (value === null) {
      delete next[key];
    } else {
      next[key] = validateText(key, value);
    }
  }
  return next;
}

function patchParams(current: BotConfigOverrides["params"], raw: unknown) {
  const next: Partial<Record<ParamKey, number>> = { ...current };
  for (const [key, value] of Object.entries(asRecord(raw, "params"))) {
    if (!isParamKey(key)) {
      throw new ValidationError(`Parametro desconocido: ${key}`, { field: `params.${key}` });
    }
    if (value === null) {
      delete next[key];
    } else {
      next[key] = validateParam(key, value);
    }
  }
  return next;
}

function validateText(key: TextKey, value: unknown): string {
  const field = `texts.${key}`;
  if (typeof value !== "string" || value.trim() === "" || value.length > TEXT_MAX_LENGTH) {
    throw new ValidationError(`${field} debe tener entre 1 y ${TEXT_MAX_LENGTH} caracteres`, {
      field,
      max: TEXT_MAX_LENGTH,
    });
  }
  if (/[<>]/.test(value)) {
    throw new ValidationError(`${field} es texto plano: no admite HTML`, { field });
  }
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!ALLOWED_PLACEHOLDERS.has(match[1] ?? "")) {
      throw new ValidationError(`Marcador desconocido en ${field}: {${match[1] ?? ""}}`, {
        field,
        allowed: [...ALLOWED_PLACEHOLDERS],
      });
    }
  }
  return value;
}

function validateParam(key: ParamKey, value: unknown): number {
  const spec = PARAM_SPECS[key];
  const field = `params.${key}`;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < spec.min ||
    value > spec.max
  ) {
    throw new ValidationError(`${field} debe ser un entero entre ${spec.min} y ${spec.max}`, {
      field,
      min: spec.min,
      max: spec.max,
    });
  }
  return value;
}

function isValid(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}
