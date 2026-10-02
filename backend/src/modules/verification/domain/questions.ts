/**
 * Banco de preguntas de seguridad. Agregar una pregunta = una entrada aqui y su texto
 * predeterminado en bot-config (`textKey`). El motor y el esquema no cambian.
 * Las respuestas se comparan en memoria y se descartan (GOBERNANZA §1.5).
 */
export type VerifiableRecord = {
  readonly id: string;
  readonly birthDate: string;
  readonly phone: string | null;
  readonly email: string | null;
};

export type QuestionOption = { readonly value: string; readonly label: string };

export type VerificationQuestion = {
  readonly id: string;
  readonly source: "birth_date" | "phone" | "email";
  readonly textKey: string;
  readonly input: "text" | "options";
  isAvailable(record: VerifiableRecord): boolean;
  expected(record: VerifiableRecord): string;
  normalize(raw: string): string;
  options?(record: VerifiableRecord): QuestionOption[];
};

const digits = (raw: string): string => raw.replace(/\D/g, "");
const asNumber = (raw: string): string => {
  const only = digits(raw);
  return only === "" ? "" : String(Number(only));
};

/** Celular nacional: sin indicativo 57 si viene con el. */
function nationalPhone(phone: string | null): string {
  const only = digits(phone ?? "");
  return only.length > 10 && only.startsWith("57") ? only.slice(2) : only;
}

const MONTHS = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" });
const MONTH_OPTIONS: QuestionOption[] = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: MONTHS.format(new Date(Date.UTC(2000, i, 1))),
}));

const DECOY_LETTERS = "abcdefghijklmnopqrstuvwxyz";

function emailHint(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.charAt(0)}•••@${domain}`;
}

/** FNV-1a: semilla estable por expediente para que los senuelos no cambien entre sesiones. */
function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Proveedores comunes: solo con ellos se ofrece la pregunta de correo, para que el dominio
 * de la pista no delate datos del paciente a quien aun no se verifica.
 */
const COMMON_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
] as const;

function emailDomain(email: string | null): string {
  const text = (email ?? "").trim().toLowerCase();
  return text.includes("@") ? text.slice(text.indexOf("@") + 1) : "";
}

function hasCommonDomain(email: string | null): boolean {
  return (COMMON_DOMAINS as readonly string[]).includes(emailDomain(email));
}

/**
 * Cuatro opciones: la real y tres senuelos que varian en inicial Y en dominio (todos de la
 * lista comun), asi el conjunto no delata el dominio real. Deterministas por expediente y
 * acotadas a 60 pasos.
 */
function emailOptions(record: VerifiableRecord): QuestionOption[] {
  const real = emailHint(record.email ?? "");
  const hints = new Set([real]);
  const seed = stableHash(record.id);
  for (let step = 0; step < 60 && hints.size < 4; step++) {
    const letter = DECOY_LETTERS.charAt((seed + step * 7) % DECOY_LETTERS.length);
    const domain = COMMON_DOMAINS[((seed >>> 8) + step) % COMMON_DOMAINS.length];
    hints.add(`${letter}•••@${domain}`);
  }
  return [...hints].sort().map((hint) => ({ value: hint, label: hint }));
}

const always = () => true;

export const QUESTION_BANK: readonly VerificationQuestion[] = [
  {
    id: "birth_day",
    source: "birth_date",
    textKey: "verify_q_birth_day",
    input: "text",
    isAvailable: always,
    expected: (r) => asNumber(r.birthDate.slice(8, 10)),
    normalize: asNumber,
  },
  {
    id: "birth_month",
    source: "birth_date",
    textKey: "verify_q_birth_month",
    input: "options",
    isAvailable: always,
    expected: (r) => asNumber(r.birthDate.slice(5, 7)),
    normalize: asNumber,
    options: () => MONTH_OPTIONS.map((option) => ({ ...option })),
  },
  {
    id: "birth_year",
    source: "birth_date",
    textKey: "verify_q_birth_year",
    input: "text",
    isAvailable: always,
    expected: (r) => r.birthDate.slice(0, 4),
    normalize: digits,
  },
  {
    id: "phone_last_4",
    source: "phone",
    textKey: "verify_q_phone_last_4",
    input: "text",
    isAvailable: (r) => nationalPhone(r.phone).length >= 7,
    expected: (r) => nationalPhone(r.phone).slice(-4),
    normalize: digits,
  },
  {
    id: "phone_first_3",
    source: "phone",
    textKey: "verify_q_phone_first_3",
    input: "text",
    isAvailable: (r) => nationalPhone(r.phone).length >= 7,
    expected: (r) => nationalPhone(r.phone).slice(0, 3),
    normalize: digits,
  },
  {
    id: "email_hint",
    source: "email",
    textKey: "verify_q_email_hint",
    input: "options",
    isAvailable: (r) => hasCommonDomain(r.email),
    expected: (r) => emailHint(r.email ?? ""),
    normalize: (raw) => raw.trim().toLowerCase(),
    options: emailOptions,
  },
];

export function questionById(id: string): VerificationQuestion | null {
  return QUESTION_BANK.find((question) => question.id === id) ?? null;
}

export function answerMatches(questionId: string, record: VerifiableRecord, raw: string): boolean {
  const question = questionById(questionId);
  if (!question?.isAvailable(record)) {
    return false;
  }
  const expected = question.expected(record);
  return expected !== "" && question.normalize(raw) === expected;
}
