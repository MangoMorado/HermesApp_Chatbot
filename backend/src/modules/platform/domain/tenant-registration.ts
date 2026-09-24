import { asRecord, requiredText } from "@/modules/shared/domain/input";
import { ValidationError } from "@/modules/shared/domain/validation-error";

export type TenantSummary = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: Date;
};

/** `allowedOrigins` se valida al aprovisionar el bot-config (su dueño). */
export type TenantDraft = {
  readonly slug: string;
  readonly name: string;
  readonly allowedOrigins: unknown;
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const NAME_MAX_LENGTH = 120;

export function parseTenantDraft(raw: unknown): TenantDraft {
  const data = asRecord(raw, "body");
  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  if (!SLUG.test(slug)) {
    throw new ValidationError(
      "slug: minusculas, digitos y guiones internos, de 1 a 50 caracteres",
      {
        field: "slug",
      },
    );
  }
  return {
    slug,
    name: requiredText(data.name, "name", NAME_MAX_LENGTH),
    allowedOrigins: data.allowed_origins ?? [],
  };
}
