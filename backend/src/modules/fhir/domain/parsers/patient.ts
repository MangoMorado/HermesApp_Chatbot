import { fhirUnprocessable } from "../fhir-error";
import type { PatientWriteCommand } from "../ports/writers";
import { documentCodeOf, PRE_REGISTERED_TAG, PRE_REGISTRATION_SYSTEM } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import {
  assertObject,
  pickKnown,
  readBodyId,
  readIdentifierArray,
  requireQueryIdentifier,
  requireResourceType,
  requireString,
} from "./body";

type PatientPayload = Omit<PatientWriteCommand, "tenantId" | "actor"> & {
  readonly bodyId: string | null;
};

const ALLOWED_KEYS = [
  "resourceType",
  "id",
  "identifier",
  "active",
  "name",
  "birthDate",
  "telecom",
] as const;

export function parsePatientBody(body: unknown, queryIdentifier: FhirIdentifier): PatientPayload {
  const resource = assertObject(body);
  const fields = pickKnown(resource, ALLOWED_KEYS, ["meta", "text", "extension"]);
  requireResourceType(fields, "Patient");
  if (hasPreRegisteredTag(resource.meta)) {
    throw fhirUnprocessable("business-rule", "Patient no puede traer el tag pre-registered");
  }
  if (fields.active !== undefined && fields.active !== true) {
    throw fhirUnprocessable("processing", "active debe ser true en Patient");
  }
  const identifiers = readIdentifierArray(fields.identifier);
  requireQueryIdentifier(identifiers, queryIdentifier);
  const identity = readPatientIdentifiers(identifiers);
  const names = readPatientName(fields.name);
  const telecom = readTelecom(fields.telecom);
  return {
    bodyId: readBodyId(fields.id),
    queryIdentifier,
    ...identity,
    ...names,
    birthDate: readBirthDate(fields.birthDate),
    ...telecom,
  };
}

function readPatientIdentifiers(identifiers: readonly FhirIdentifier[]): {
  businessIdentifier: FhirIdentifier;
  documentType: NonNullable<ReturnType<typeof documentCodeOf>>;
  documentNumber: string;
} {
  if (identifiers.length !== 2) {
    throw fhirUnprocessable("processing", "Patient.identifier debe tener exactamente dos entradas");
  }
  const documents = identifiers.filter((item) => documentCodeOf(item.system) !== null);
  const businesses = identifiers.filter((item) => documentCodeOf(item.system) === null);
  if (documents.length !== 1 || businesses.length !== 1) {
    throw fhirUnprocessable(
      "processing",
      "Patient debe tener un identifier de negocio y uno de documento",
    );
  }
  const document = documents[0] as FhirIdentifier;
  const business = businesses[0] as FhirIdentifier;
  const documentType = documentCodeOf(document.system);
  if (documentType === null || business.system === PRE_REGISTRATION_SYSTEM) {
    throw fhirUnprocessable("processing", "Identifier de negocio invalido");
  }
  return {
    businessIdentifier: business,
    documentType,
    documentNumber: document.value,
  };
}

function readPatientName(value: unknown): { givenNames: string; familyNames: string } {
  if (!Array.isArray(value) || value.length !== 1) {
    throw fhirUnprocessable("processing", "Patient.name debe tener una entrada");
  }
  if (value[0] === null || typeof value[0] !== "object" || Array.isArray(value[0])) {
    throw fhirUnprocessable("processing", "Patient.name debe tener una entrada");
  }
  const name = pickKnown(
    value[0] as Record<string, unknown>,
    ["family", "given"],
    ["use", "text", "prefix", "suffix", "period", "extension"],
  );
  if (!Array.isArray(name.given) || name.given.length === 0) {
    throw fhirUnprocessable("processing", "name.given es obligatorio");
  }
  const given = name.given.map((part) => requireString(part, "name.given"));
  return {
    givenNames: given.join(" "),
    familyNames: requireString(name.family, "name.family"),
  };
}

function readBirthDate(value: unknown): string {
  const birthDate = requireString(value, "birthDate");
  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== birthDate
  ) {
    throw fhirUnprocessable("processing", "birthDate debe ser una fecha valida");
  }
  return birthDate;
}

function readTelecom(value: unknown): { phone: string | null; email: string | null } {
  if (value === undefined) {
    return { phone: null, email: null };
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw fhirUnprocessable("processing", "telecom debe tener al menos una entrada");
  }
  const result: { phone: string | null; email: string | null } = { phone: null, email: null };
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw fhirUnprocessable("processing", "telecom debe contener objetos");
    }
    const row = pickKnown(
      item as Record<string, unknown>,
      ["system", "value"],
      ["use", "rank", "period", "extension"],
    );
    if (row.system !== "phone" && row.system !== "email") {
      throw fhirUnprocessable("processing", "telecom.system debe ser phone o email");
    }
    if (result[row.system] !== null) {
      throw fhirUnprocessable("processing", `telecom.${row.system} no puede repetirse`);
    }
    result[row.system] = requireString(row.value, "telecom.value");
  }
  return result;
}

function hasPreRegisteredTag(meta: unknown): boolean {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return false;
  }
  const tag = (meta as Record<string, unknown>).tag;
  return (
    Array.isArray(tag) &&
    tag.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).system === PRE_REGISTERED_TAG.system &&
        (item as Record<string, unknown>).code === PRE_REGISTERED_TAG.code,
    )
  );
}
