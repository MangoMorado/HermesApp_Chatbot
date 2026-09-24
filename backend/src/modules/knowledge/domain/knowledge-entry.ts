import { asRecord, requiredText } from "@/modules/shared/domain/input";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import { normalizeTokens } from "./normalize";

export const KNOWLEDGE_LIMITS = {
  category: 60,
  question: 200,
  answer: 1000,
  detail: 4000,
  keywords: 20,
  position: 100_000,
  entriesPerTenant: 500,
} as const;

export type KnowledgeEntryDraft = {
  readonly category: string;
  readonly question: string;
  readonly answer: string;
  readonly detail: string | null;
  readonly keywords: readonly string[];
  readonly position: number;
  readonly active: boolean;
};

export type KnowledgeEntry = KnowledgeEntryDraft & {
  readonly id: string;
  readonly tenantId: TenantId;
};

type RawDraft = Record<keyof KnowledgeEntryDraft, unknown>;

const FIELDS: readonly (keyof KnowledgeEntryDraft)[] = [
  "category",
  "question",
  "answer",
  "detail",
  "keywords",
  "position",
  "active",
];

export function parseEntryDraft(raw: unknown): KnowledgeEntryDraft {
  const data = asRecord(raw, "body");
  return validateDraft({
    category: data.category,
    question: data.question,
    answer: data.answer,
    detail: data.detail ?? null,
    keywords: data.keywords ?? [],
    position: data.position ?? 0,
    active: data.active ?? true,
  });
}

/** Parche parcial: lo ausente conserva el valor actual y el resultado se revalida entero. */
export function mergeEntryPatch(existing: KnowledgeEntryDraft, raw: unknown): KnowledgeEntryDraft {
  const data = asRecord(raw, "body");
  const merged = Object.fromEntries(
    FIELDS.map((field) => [field, Object.hasOwn(data, field) ? data[field] : existing[field]]),
  ) as RawDraft;
  return validateDraft(merged);
}

function validateDraft(raw: RawDraft): KnowledgeEntryDraft {
  return {
    category: requiredText(raw.category, "category", KNOWLEDGE_LIMITS.category),
    question: requiredText(raw.question, "question", KNOWLEDGE_LIMITS.question),
    answer: requiredText(raw.answer, "answer", KNOWLEDGE_LIMITS.answer),
    detail:
      raw.detail === null ? null : requiredText(raw.detail, "detail", KNOWLEDGE_LIMITS.detail),
    keywords: keywordsOf(raw.keywords),
    position: positionOf(raw.position),
    active: booleanOf(raw.active, "active"),
  };
}

function keywordsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError("keywords debe ser una lista de textos", { field: "keywords" });
  }
  const tokens = [...new Set(value.flatMap((item: string) => normalizeTokens(item)))];
  if (tokens.length > KNOWLEDGE_LIMITS.keywords) {
    throw new ValidationError(`keywords admite como maximo ${KNOWLEDGE_LIMITS.keywords}`, {
      field: "keywords",
      max: KNOWLEDGE_LIMITS.keywords,
    });
  }
  return tokens;
}

function positionOf(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > KNOWLEDGE_LIMITS.position
  ) {
    throw new ValidationError(
      `position debe ser un entero entre 0 y ${KNOWLEDGE_LIMITS.position}`,
      {
        field: "position",
      },
    );
  }
  return value as number;
}

function booleanOf(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} debe ser booleano`, { field });
  }
  return value;
}
