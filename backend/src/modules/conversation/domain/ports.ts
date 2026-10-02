import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { ConversationParams, ConversationState, Effect, EffectOutcome } from "./types";

export type StoredConversation = {
  readonly id: string;
  readonly tenantId: string;
  readonly widgetSessionId: string;
  readonly state: ConversationState;
  readonly messageCount: number;
};

export type NewMessage = {
  readonly author: "bot" | "patient";
  /** Ya redactado si `redacted`: el repositorio nunca recibe el contenido sensible. */
  readonly text: string;
  readonly redacted: boolean;
};

export type HistoryMessage = NewMessage & { readonly createdAt: Date };

export type ConversationRepository = {
  /**
   * Crea la conversacion de la sesion si no existe (ON CONFLICT DO NOTHING) y la devuelve
   * bloqueada FOR UPDATE: los turnos de una misma sesion se serializan.
   */
  open(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly widgetSessionId: string;
    readonly state: ConversationState;
    readonly now: Date;
  }): Promise<{ readonly conversation: StoredConversation; readonly created: boolean }>;
  save(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly state: ConversationState;
    readonly medicalRecordId: string | null;
    readonly messageCount: number;
    readonly now: Date;
  }): Promise<void>;
};

export type MessageRepository = {
  append(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly firstSeq: number;
    readonly messages: readonly NewMessage[];
    readonly now: Date;
  }): Promise<void>;
  list(tenantId: string, conversationId: string): Promise<HistoryMessage[]>;
};

export type ConversationConfig = {
  readonly texts: Readonly<Record<string, string>>;
  readonly clinicName: string;
  readonly params: ConversationParams;
};

export type ConversationConfigReader = (tenantId: string) => Promise<ConversationConfig>;

export type EffectContext = {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly actor: AuditActor;
};

/** Lo cumple el composition root con los casos de uso de cada modulo, dentro de un SAVEPOINT. */
export type EffectRunner = (effect: Effect, context: EffectContext) => Promise<EffectOutcome>;
