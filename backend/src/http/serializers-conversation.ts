import type { HistoryView, TurnView } from "@/modules/conversation/application/conversation";
import { REDACTED } from "@/modules/conversation/domain/text";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { IdempotentResult } from "./idempotency-core";

export function conversationTurnJson(turn: TurnView) {
  return { messages: turn.messages.map((m) => m.text), options: turn.options, input: turn.input };
}

/** Lo que se guarda en idempotency_keys: sin las lineas redactadas (refinamiento 10). */
export function storedTurnJson(turn: TurnView, sessionId: string) {
  const messages = turn.messages.map((m) => (m.redacted ? REDACTED : m.text));
  return { session_id: sessionId, body: { messages, options: turn.options, input: turn.input } };
}

/** Repeticion: solo para la misma sesion; otra sesion del tenant con la misma clave es 409. */
export function replayTurn(stored: IdempotentResult, sessionId: string): IdempotentResult {
  const body = stored.body as { session_id?: unknown; body?: unknown } | null;
  if (body?.session_id !== sessionId) {
    throw new ConflictError("Idempotency-Key reutilizada con otra peticion");
  }
  return { status: stored.status, body: body.body };
}

export function conversationHistoryJson(view: HistoryView) {
  return {
    messages: view.messages.map((m) => ({
      author: m.author,
      text: m.text,
      redacted: m.redacted,
      created_at: m.createdAt.toISOString(),
    })),
    options: view.options,
    input: view.input,
  };
}
