import { fhirInvalid } from "../fhir-error";
import type { PatientWriteCommand } from "../ports/writers";
import { documentCodeOf } from "../profiles";
import type { FhirIdentifier } from "../resources/types";
import {
  assertNoExtraKeys,
  assertObject,
  readIdentifierArray,
  requireQueryIdentifier,
  requireResourceType,
  requireString,
} from "./body";

type PatientPayload = Omit<PatientWriteCommand, "tenantId" | "actor">;

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
  assertNoExtraKeys(resource, ALLOWED_KEYS);
  requireResourceType(resource, "Patient");
  if (resource.active !== undefined && resource.active !== true) {
    throw fhirInvalid("active debe ser true en Patient");
  }
  const identifiers = readIdentifierArray(resource.identifier);
  requireQueryIdentifier(identifiers, queryIdentifier);
  const identity = readPatientIdentifiers(identifiers);
  const names = readPatientName(resource.name);
  const telecom = readTelecom(resource.telecom);
  return {
    queryIdentifier,
    ...identity,
    ...names,
    birthDate: readBirthDate(resource.birthDate),
    ...telecom,
  };
}

function readPatientIdentifiers(identifiers: readonly FhirIdentifier[]): {
  businessIdentifier: FhirIdentifier;
  documentType: NonNullable<ReturnType<typeof documentCodeOf>>;
  documentNumber: string;
} {
  if (identifiers.length !== 2) {
    throw fhirInvalid("Patient.identifier debe tener exactamente dos entradas");
  }
  const documents = identifiers.filter((item) => documentCodeOf(item.system) !== null);
  const businesses = identifiers.filter((item) => documentCodeOf(item.system) === null);
  if (documents.length !== 1 || businesses.length !== 1) {
    throw fhirInvalid("Patient debe tener un identifier de negocio y uno de documento");
  }
  const document = documents[0] as FhirIdentifier;
  const business = businesses[0] as FhirIdentifier;
  const documentType = documentCodeOf(document.system);
  if (documentType === null || business.system.endsWith(":pre-registration")) {
    throw fhirInvalid("Identifier de negocio invalido");
  }
  return {
    businessIdentifier: business,
    documentType,
    documentNumber: document.value,
  };
}

function readPatientName(value: unknown): { givenNames: string; familyNames: string } {
  if (!Array.isArray(value) || value.length !== 1) {
    throw fhirInvalid("Patient.name debe tener una entrada");
  }
  const name = assertObject(value[0]);
  assertNoExtraKeys(name, ["family", "given"]);
  if (!Array.isArray(name.given) || name.given.length === 0) {
    throw fhirInvalid("name.given es obligatorio");
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
    throw fhirInvalid("birthDate debe ser una fecha valida");
  }
  return birthDate;
}

function readTelecom(value: unknown): { phone: string | null; email: string | null } {
  if (value === undefined) {
    return { phone: null, email: null };
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw fhirInvalid("telecom debe tener al menos una entrada");
  }
  const result: { phone: string | null; email: string | null } = { phone: null, email: null };
  for (const item of value) {
    const row = assertObject(item);
    assertNoExtraKeys(row, ["system", "value"]);
    if (row.system !== "phone" && row.system !== "email") {
      throw fhirInvalid("telecom.system debe ser phone o email");
    }
    if (result[row.system] !== null) {
      throw fhirInvalid(`telecom.${row.system} no puede repetirse`);
    }
    result[row.system] = requireString(row.value, "telecom.value");
  }
  return result;
}
