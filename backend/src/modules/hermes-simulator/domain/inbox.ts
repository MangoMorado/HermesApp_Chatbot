/** Lo que el simulador ve de una solicitud: solo identificadores de Hermes, como por FHIR. */
export type InboxIdentifier = { readonly system: string; readonly value: string };

export type InboxRef = {
  readonly identifier: InboxIdentifier;
  readonly startAt: Date;
  readonly endAt: Date;
};

export type InboxRequest = {
  readonly id: string;
  readonly kind: "book" | "reschedule" | "cancel";
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly resolutionReason: "slot_unavailable" | "declined" | null;
  readonly patient: {
    readonly identifier: InboxIdentifier;
    readonly documentType: string;
    readonly documentNumber: string;
    readonly givenNames: string;
    readonly familyNames: string;
  };
  readonly slot: InboxRef | null;
  readonly appointment: InboxRef | null;
  readonly resultingAppointment: { readonly identifier: InboxIdentifier } | null;
};

export type InboxResolution =
  | { readonly outcome: "approved"; readonly appointmentIdentifier: InboxIdentifier }
  | { readonly outcome: "rejected"; readonly reason: "slot_unavailable" | "declined" };
