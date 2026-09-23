import { asRecord, requiredText } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";

/** La plataforma emite tokens de panel y de servicio; los de widget salen de una sesion. */
export const ISSUABLE_ROLES = ["operator", "admin", "service"] as const;
export type IssuableRole = (typeof ISSUABLE_ROLES)[number];

export const TOKEN_TTL_MINUTES: Readonly<Record<IssuableRole, { default: number; max: number }>> = {
  operator: { default: 480, max: 720 },
  admin: { default: 480, max: 720 },
  service: { default: 60, max: 1440 },
};

const SUBJECT_MAX_LENGTH = 120;
const TENANT_ID_MAX_LENGTH = 200;
/** Reservado para los tokens de sesion del widget. */
const RESERVED_SUBJECT_PREFIX = "widget:";

export type TokenRequest = {
  readonly tenantId: string;
  readonly role: IssuableRole;
  readonly subject: string;
  readonly ttlMinutes: number;
};

export function parseTokenRequest(raw: unknown): TokenRequest {
  const data = asRecord(raw, "body");
  const role = roleOf(data.role);
  return {
    tenantId: requiredText(data.tenant_id, "tenant_id", TENANT_ID_MAX_LENGTH),
    role,
    subject: subjectOf(data.subject),
    ttlMinutes: ttlOf(data.ttl_minutes, role),
  };
}

function roleOf(value: unknown): IssuableRole {
  if (typeof value === "string" && (ISSUABLE_ROLES as readonly string[]).includes(value)) {
    return value as IssuableRole;
  }
  throw new ValidationError(`role debe ser uno de: ${ISSUABLE_ROLES.join(", ")}`, {
    field: "role",
    allowed: [...ISSUABLE_ROLES],
  });
}

function subjectOf(value: unknown): string {
  const subject = requiredText(value, "subject", SUBJECT_MAX_LENGTH);
  if (subject.startsWith(RESERVED_SUBJECT_PREFIX)) {
    throw new ValidationError(`subject no puede empezar por ${RESERVED_SUBJECT_PREFIX}`, {
      field: "subject",
    });
  }
  return subject;
}

function ttlOf(value: unknown, role: IssuableRole): number {
  const spec = TOKEN_TTL_MINUTES[role];
  if (value === undefined || value === null) {
    return spec.default;
  }
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > spec.max) {
    throw new ValidationError(`ttl_minutes debe ser un entero entre 1 y ${spec.max}`, {
      field: "ttl_minutes",
      max: spec.max,
    });
  }
  return value as number;
}
