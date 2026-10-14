import type { AppointmentStatusCode, FhirSlotStatus, ResourceType } from "../profiles";

/** Subconjunto de R4 que este servicio expone. Solo los campos que se emiten. */

export type FhirIdentifier = { readonly system: string; readonly value: string };
export type FhirReference = { readonly reference: string };
export type FhirCoding = { readonly system: string; readonly code: string };

export type FhirPatient = {
  readonly resourceType: "Patient";
  readonly id: string;
  readonly meta?: { readonly tag: readonly FhirCoding[] };
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly name: readonly { readonly family: string; readonly given?: readonly string[] }[];
  readonly birthDate: string;
  readonly telecom?: readonly { readonly system: "phone" | "email"; readonly value: string }[];
};

export type FhirPractitioner = {
  readonly resourceType: "Practitioner";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly name: readonly { readonly text: string }[];
};

export type FhirHealthcareService = {
  readonly resourceType: "HealthcareService";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly name: string;
};

export type FhirSchedule = {
  readonly resourceType: "Schedule";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly active: boolean;
  readonly actor: readonly FhirReference[];
};

export type FhirSlot = {
  readonly resourceType: "Slot";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly schedule: FhirReference;
  readonly status: FhirSlotStatus;
  readonly start: string;
  readonly end: string;
};

export type FhirAppointment = {
  readonly resourceType: "Appointment";
  readonly id: string;
  readonly identifier: readonly FhirIdentifier[];
  readonly status: AppointmentStatusCode;
  readonly start: string;
  readonly end: string;
  readonly slot: readonly FhirReference[];
  readonly participant: readonly { readonly actor: FhirReference; readonly status: "accepted" }[];
};

export type FhirResource =
  | FhirPatient
  | FhirPractitioner
  | FhirHealthcareService
  | FhirSchedule
  | FhirSlot
  | FhirAppointment;

export type IssueCode =
  | "login"
  | "forbidden"
  | "not-found"
  | "not-supported"
  | "invalid"
  | "conflict"
  | "exception";

export type OperationOutcome = {
  readonly resourceType: "OperationOutcome";
  readonly issue: readonly {
    readonly severity: "error";
    readonly code: IssueCode;
    readonly diagnostics: string;
  }[];
};

export type BundleLink = {
  readonly relation: "self" | "next" | "previous";
  readonly url: string;
};

export type FhirBundle = {
  readonly resourceType: "Bundle";
  readonly type: "searchset";
  readonly total: number;
  readonly link: readonly BundleLink[];
  readonly entry?: readonly {
    readonly fullUrl: string;
    readonly resource: FhirResource;
    readonly search: { readonly mode: "match" };
  }[];
};

export type SearchParamType = "token" | "reference" | "date";

export type CapabilityStatement = {
  readonly resourceType: "CapabilityStatement";
  readonly status: "active";
  readonly date: string;
  readonly kind: "instance";
  readonly software: { readonly name: string };
  readonly implementation: { readonly description: string };
  readonly fhirVersion: string;
  readonly format: readonly string[];
  readonly rest: readonly {
    readonly mode: "server";
    readonly security: { readonly description: string };
    readonly resource: readonly {
      readonly type: ResourceType;
      readonly interaction: readonly {
        readonly code: "read" | "search-type" | "update";
      }[];
      readonly conditionalUpdate?: boolean;
      readonly updateCreate?: boolean;
      readonly searchParam: readonly { readonly name: string; readonly type: SearchParamType }[];
    }[];
  }[];
};
