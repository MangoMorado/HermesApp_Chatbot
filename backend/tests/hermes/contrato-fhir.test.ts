import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_REQUEST_SYSTEM,
  documentSystem,
  PRE_REGISTERED_TAG,
  PRE_REGISTRATION_SYSTEM,
  REPLACES_APPOINTMENT,
  RESOLUTION_REASON_SYSTEM,
  SLOT_STATUS,
} from "@/modules/fhir/domain/profiles";
import {
  documentSystem as copiedDocumentSystem,
  PRE_REGISTRATION_SYSTEM as copiedPre,
  RESOLUTION_REASON_SYSTEM as copiedReason,
  PRE_REGISTERED_TAG as copiedTag,
  DOCUMENT_SYSTEM_PREFIX,
  REPLACES_EXTENSION,
  REQUEST_SYSTEM,
  SLOT_STATUS_CODE,
} from "@/modules/hermes-simulator/domain/fhir-contract";

describe("hermes-simulador: paridad del contrato FHIR", () => {
  it("los literales que envia el simulador coinciden con profiles.ts", () => {
    expect(REQUEST_SYSTEM).toBe(APPOINTMENT_REQUEST_SYSTEM);
    expect(copiedPre).toBe(PRE_REGISTRATION_SYSTEM);
    expect(copiedTag).toEqual(PRE_REGISTERED_TAG);
    expect(REPLACES_EXTENSION).toBe(REPLACES_APPOINTMENT);
    expect(copiedReason).toBe(RESOLUTION_REASON_SYSTEM);
    expect(SLOT_STATUS_CODE).toEqual(SLOT_STATUS);
    expect(copiedDocumentSystem("CC")).toBe(documentSystem("CC"));
    expect(DOCUMENT_SYSTEM_PREFIX).toBe("urn:ingenius:document:");
  });
});
