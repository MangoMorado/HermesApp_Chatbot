import { buildSeed, IDENTIFIER_SYSTEMS, type SeedPatient } from "../../../prisma/seed/data";
import type { Answers, Letter } from "./chat";

/**
 * Paciente sembrado que usa cada recorrido (el primero de cada clinica, activo) y sus
 * respuestas de verificacion, calculadas desde `prisma/seed/data.ts` sin copiar valores. La
 * pregunta se sortea al azar, por eso viajan todas las que el banco puede hacer.
 */
const ANCHOR = "2026-01-05";
const TIME_ZONE = "America/Bogota";
const MONTHS = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" });

function patientOf(letter: Letter): SeedPatient {
  const tenant = buildSeed(ANCHOR, TIME_ZONE)[letter === "a" ? 0 : 1];
  const patient = tenant?.patients.find((candidate) => candidate.status === "active");
  if (!patient) {
    throw new Error(`El seed no tiene paciente activo para la clinica ${letter}`);
  }
  return patient;
}

export function seedPatient(letter: Letter) {
  const patient = patientOf(letter);
  return {
    documentNumber: patient.documentNumber,
    identifier: `${IDENTIFIER_SYSTEMS.patient}|${patient.identifierValue}`,
  };
}

export function verificationAnswers(letter: Letter): Answers {
  const { birthDate, phone } = patientOf(letter);
  const month = Number(birthDate.slice(5, 7));
  const digits = phone.replace(/\D/g, "");
  return {
    birth_day: { kind: "text", value: String(Number(birthDate.slice(8, 10))) },
    birth_month: { kind: "option", value: MONTHS.format(new Date(Date.UTC(2000, month - 1, 1))) },
    birth_year: { kind: "text", value: birthDate.slice(0, 4) },
    phone_last_4: { kind: "text", value: digits.slice(-4) },
    phone_first_3: { kind: "text", value: digits.slice(0, 3) },
  };
}
