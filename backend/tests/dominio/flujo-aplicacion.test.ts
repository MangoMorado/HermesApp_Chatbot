import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS } from "@/modules/bot-config/domain/bot-config";
import {
  type ConversationDeps,
  createGetConversation,
  createHandleMessage,
} from "@/modules/conversation/application/conversation";
import type {
  ConversationRepository,
  HistoryMessage,
  MessageRepository,
  StoredConversation,
} from "@/modules/conversation/domain/ports";
import { STEPS } from "@/modules/conversation/domain/steps";
import type { Effect, EffectOutcome } from "@/modules/conversation/domain/types";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import type { Challenge } from "@/modules/verification/domain/challenge";
import { fakeReads, firstRandom, NOW, TZ } from "./flujo-support";

const RECORD = { id: "mr-1", birthDate: "1990-03-07", phone: "3001234567", email: null };
const CHALLENGE: Challenge = {
  id: "v1",
  tenantId: "t1",
  medicalRecordId: "mr-1",
  questionIds: ["birth_day", "phone_last_4"],
  failedAttempts: 0,
  lockedUntil: null,
};

function memory() {
  const rows = new Map<string, StoredConversation>();
  const messages: (HistoryMessage & { conversationId: string; seq: number })[] = [];
  const conversations: ConversationRepository = {
    async open(input) {
      const existing = rows.get(input.widgetSessionId);
      if (existing) return { conversation: existing, created: false };
      const created = {
        id: input.id,
        tenantId: input.tenantId,
        widgetSessionId: input.widgetSessionId,
        state: input.state,
        messageCount: 0,
      };
      rows.set(input.widgetSessionId, created);
      return { conversation: created, created: true };
    },
    async save(input) {
      for (const [key, row] of rows) {
        if (row.id === input.id)
          rows.set(key, { ...row, state: input.state, messageCount: input.messageCount });
      }
    },
  };
  const store: MessageRepository = {
    async append(input) {
      for (const [i, m] of input.messages.entries()) {
        messages.push({
          ...m,
          createdAt: input.now,
          conversationId: input.conversationId,
          seq: input.firstSeq + i,
        });
      }
    },
    async list(_t, conversationId) {
      return messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.seq - b.seq);
    },
  };
  return { rows, messages, conversations, store };
}

function setup(runEffect: (effect: Effect) => Promise<EffectOutcome> = async () => ({ ok: true })) {
  const mem = memory();
  let next = 0;
  const deps: ConversationDeps = {
    conversations: mem.conversations,
    messages: mem.store,
    config: async () => ({
      texts: DEFAULT_TEXTS,
      clinicName: "Clínica Sol",
      params: { kbMaxResults: 3 },
    }),
    reads: fakeReads({
      findPatient: async (_t, _type, number) => (number === "1020304050" ? RECORD : null),
      getPatient: async () => RECORD,
      challenge: async () => CHALLENGE,
    }),
    runEffect: (effect) => runEffect(effect),
    clock: { now: () => NOW },
    ids: { next: () => `id-${++next}` },
    random: firstRandom,
    timeZone: TZ,
    steps: STEPS,
  };
  const request = {
    tenantId: toTenantId("t1"),
    sessionId: "s1",
    actorSubject: "widget:s1",
    actorRole: "widget",
    requestId: "r1",
  };
  return { mem, get: createGetConversation(deps), send: createHandleMessage(deps), request };
}

describe("flujo: aplicacion", () => {
  it("la primera lectura crea la conversacion con bienvenida una sola vez", async () => {
    const { get, request } = setup();
    const first = await get(request);
    const again = await get(request);
    expect(first.messages.map((m) => m.text)).toEqual([
      "Hola, soy el asistente virtual de Clínica Sol. ¿En qué te puedo ayudar?",
      "Elige una opción.",
    ]);
    expect(again.messages).toHaveLength(2);
    expect(first.options.map((o) => o.label)).toEqual([
      "Mis citas",
      "Consultas generales",
      "Hablar con un asesor",
    ]);
  });

  it("las respuestas de verificacion no llegan ni a los mensajes ni al estado", async () => {
    const { get, send, request, mem } = setup(async (effect) =>
      effect.kind === "verification_attempt"
        ? {
            ok: true,
            verification: { result: "verified", remainingAttempts: 3, lockedUntil: null },
          }
        : { ok: true },
    );
    type View = {
      readonly messages: readonly { readonly text: string }[];
      readonly options: readonly { readonly id: string; readonly label: string }[];
    };
    let view: View = await get(request);
    const choose = async (label: string) => {
      const option = view.options.find((o) => o.label === label);
      view = { ...view, ...(await send({ ...request, message: { optionId: option?.id ?? "?" } })) };
    };
    const type = async (text: string) => {
      view = { ...view, ...(await send({ ...request, message: { text } })) };
    };
    await choose("Mis citas");
    await choose("Cédula de ciudadanía");
    await type("1020304050");
    await type("07");
    await type("4567");
    expect(view.messages.map((m) => m.text)).toContain("Verificamos tu identidad.");
    const stored = JSON.stringify([...mem.messages, ...mem.rows.values()]);
    expect(stored).not.toContain('"07"');
    expect(stored).not.toContain("4567");
    expect(mem.messages.filter((m) => m.author === "patient").map((m) => m.text)).toEqual([
      "Mis citas",
      "Cédula de ciudadanía",
      "CC ••••4050",
      "[redactado]",
      "[redactado]",
    ]);
  });
});
