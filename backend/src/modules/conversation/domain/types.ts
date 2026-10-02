import type { Random } from "@/modules/shared/domain/ports/random";
import type { QuestionPair } from "@/modules/verification/domain/draw";
import type { DocumentType } from "./document";
import type { ConversationReads } from "./reads";
import type { BotLine, BotText } from "./text";

export type StepId =
  | "main_menu"
  | "closed"
  | "kb_query"
  | "kb_results"
  | "id_document_type"
  | "id_document_number"
  | "verify_question"
  | "verification_blocked"
  | "privacy_notice"
  | "prereg_field"
  | "prereg_confirm"
  | "appointments_menu"
  | "pick_appointment"
  | "cancel_confirm"
  | "book_service"
  | "book_practitioner"
  | "book_day"
  | "book_slot"
  | "book_confirm";

export type InputMode = "none" | "text" | "date";
export type HandoffReason = "requested" | "verification_locked" | "unverifiable";
export type PreRegField = "given_names" | "family_names" | "birth_date" | "phone" | "email";

export type OptionSpec = { readonly value: string; readonly label: BotText };
/** Opcion vigente del turno: el id es opaco y solo vale para ese turno. */
export type StoredOption = OptionSpec & { readonly id: string };

/** Nunca guarda respuestas: solo si la primera fue correcta (refinamiento 3 / §5.2). */
export type VerificationDraft = {
  readonly medicalRecordId: string;
  readonly questionIds: QuestionPair;
  readonly index: 0 | 1;
  readonly firstCorrect?: boolean;
};

/** Borrador del pre-registro; se borra al confirmar o abandonar. */
export type PreRegistrationDraft = {
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly field: PreRegField;
  readonly givenNames?: string;
  readonly familyNames?: string;
  readonly birthDate?: string;
  readonly phone?: string;
  readonly email?: string | null;
};

export type BookingDraft = {
  readonly kind: "book" | "reschedule" | "cancel";
  readonly appointmentId?: string;
  readonly serviceId?: string;
  readonly practitionerId?: string | null;
  readonly day?: string;
  readonly dayOffset?: number;
  readonly slotOffset?: number;
  readonly slotId?: string;
};

export type KbResult = { readonly id: string; readonly question: string };

export type ConversationContext = {
  readonly turn: number;
  readonly options: readonly StoredOption[];
  readonly input: InputMode;
  /** Expediente verificado (o recien pre-registrado) en esta sesion. */
  readonly patientId?: string;
  readonly documentType?: DocumentType;
  readonly verification?: VerificationDraft;
  readonly preRegistration?: PreRegistrationDraft;
  readonly booking?: BookingDraft;
  readonly kbResults?: readonly KbResult[];
  readonly handoffReason?: HandoffReason;
};

export type ConversationState = { readonly step: StepId; readonly context: ConversationContext };

export type PatientInput =
  | { readonly kind: "option"; readonly value: string; readonly label: BotText }
  | { readonly kind: "text"; readonly text: string };

export type IncomingMessage = { readonly optionId: string } | { readonly text: string };

export type AppointmentCommand =
  | { readonly kind: "book"; readonly slotId: string }
  | { readonly kind: "reschedule"; readonly appointmentId: string; readonly slotId: string }
  | { readonly kind: "cancel"; readonly appointmentId: string };

export type PreRegistrationPayload = {
  readonly documentType: DocumentType;
  readonly documentNumber: string;
  readonly givenNames: string;
  readonly familyNames: string;
  readonly birthDate: string;
  readonly phone: string;
  readonly email: string | null;
};

/** Unica forma de escribir desde un paso. A lo sumo uno por turno (refinamiento 1). */
export type Effect =
  | {
      readonly kind: "request_appointment";
      readonly medicalRecordId: string;
      readonly command: AppointmentCommand;
    }
  | { readonly kind: "pre_register"; readonly data: PreRegistrationPayload }
  | {
      readonly kind: "handoff";
      readonly reason: HandoffReason;
      readonly medicalRecordId: string | null;
    }
  | {
      readonly kind: "open_challenge";
      readonly medicalRecordId: string;
      readonly questionIds: QuestionPair;
    }
  | {
      readonly kind: "verification_attempt";
      readonly medicalRecordId: string;
      readonly success: boolean;
    };

export type EffectFailure =
  | "slot_unavailable"
  | "pending_limit_reached"
  | "appointment_change_pending"
  | "not_available"
  | "document_taken";

export type VerificationResult = {
  readonly result: "verified" | "failed" | "locked";
  readonly remainingAttempts: number;
  readonly lockedUntil: Date | null;
};

export type EffectOutcome =
  | {
      readonly ok: true;
      readonly expiresAt?: Date;
      readonly medicalRecordId?: string;
      readonly questionIds?: QuestionPair;
      readonly verification?: VerificationResult;
    }
  | { readonly ok: false; readonly failure: EffectFailure; readonly max?: number };

export type ConversationParams = { readonly kbMaxResults: number };

export type StepEnv = {
  readonly tenantId: string;
  readonly now: Date;
  readonly timeZone: string;
  readonly params: ConversationParams;
  readonly random: Random;
  readonly reads: ConversationReads;
};

export type EnterResult =
  | {
      readonly kind: "prompt";
      readonly lines: readonly BotLine[];
      readonly options: readonly OptionSpec[];
      readonly input: InputMode;
      readonly context: ConversationContext;
    }
  | {
      readonly kind: "goto";
      readonly lines: readonly BotLine[];
      readonly goto: StepId;
      readonly context: ConversationContext;
    };

export type HandleResult = {
  readonly goto: StepId;
  readonly context: ConversationContext;
  readonly lines: readonly BotLine[];
  readonly effect?: Effect;
  /** Continuacion pura (NO se llama `then`: seria un thenable y `await` la invocaria) con el resultado del efecto; no puede declarar otro efecto. */
  readonly onOutcome?: (outcome: EffectOutcome) => HandleResult;
};

export type Step = {
  readonly id: StepId;
  /** `full`: Menu (salvo en main_menu) y Asesor; `cancel_only`: solo Cancelar (verificacion). */
  readonly globals: "full" | "cancel_only";
  /** Como se guarda la entrada del paciente: etiqueta de la opcion, redactada o documento enmascarado. */
  readonly echo: "label" | "redacted" | "document";
  enter(context: ConversationContext, env: StepEnv): Promise<EnterResult>;
  handle(input: PatientInput, context: ConversationContext, env: StepEnv): Promise<HandleResult>;
};

export type StepRegistry = Readonly<Record<StepId, Step>>;
