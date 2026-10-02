import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { Random } from "@/modules/shared/domain/ports/random";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { runTurn, startConversation, type TurnOutput } from "../domain/engine";
import type {
  ConversationConfig,
  ConversationConfigReader,
  ConversationRepository,
  EffectRunner,
  HistoryMessage,
  MessageRepository,
  NewMessage,
  StoredConversation,
} from "../domain/ports";
import type { ConversationReads } from "../domain/reads";
import { REDACTED } from "../domain/text";
import type { IncomingMessage, InputMode, StepEnv, StepRegistry } from "../domain/types";
import { type RenderedMessage, type RenderedOption, renderOptions, renderText } from "./render";

export type ConversationDeps = {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly config: ConversationConfigReader;
  readonly reads: ConversationReads;
  readonly runEffect: EffectRunner;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: Random;
  readonly timeZone: string;
  readonly steps: StepRegistry;
};

export type ConversationRequest = AuditActor & {
  readonly tenantId: TenantId;
  readonly sessionId: string;
};

export type TurnView = {
  readonly messages: readonly RenderedMessage[];
  readonly options: readonly RenderedOption[];
  readonly input: InputMode;
};

export type HistoryView = {
  readonly messages: readonly HistoryMessage[];
  readonly options: readonly RenderedOption[];
  readonly input: InputMode;
};

type Opened = { readonly conversation: StoredConversation; readonly messageCount: number };

function envFor(
  deps: ConversationDeps,
  tenantId: string,
  config: ConversationConfig,
  now: Date,
): StepEnv {
  return {
    tenantId,
    now,
    timeZone: deps.timeZone,
    params: config.params,
    random: deps.random,
    reads: deps.reads,
  };
}

/** Lo que se guarda: el eco del paciente y las lineas del bot, redactadas donde corresponde. */
function toMessages(output: TurnOutput, config: ConversationConfig): NewMessage[] {
  const echo: NewMessage[] = output.echo
    ? [
        {
          author: "patient",
          text: output.echo.redacted ? REDACTED : renderText(output.echo.text, config),
          redacted: output.echo.redacted,
        },
      ]
    : [];
  const bot = output.lines.map((l): NewMessage => {
    const redacted = l.redacted === true;
    return { author: "bot", text: redacted ? REDACTED : renderText(l.text, config), redacted };
  });
  return [...echo, ...bot];
}

async function persist(
  deps: ConversationDeps,
  conversation: StoredConversation,
  count: number,
  output: TurnOutput,
  config: ConversationConfig,
  now: Date,
): Promise<number> {
  const messages = toMessages(output, config);
  const { id, tenantId } = conversation;
  await deps.messages.append({ tenantId, conversationId: id, firstSeq: count + 1, messages, now });
  const messageCount = count + messages.length;
  const medicalRecordId = output.state.context.patientId ?? null;
  await deps.conversations.save({
    id,
    tenantId,
    state: output.state,
    medicalRecordId,
    messageCount,
    now,
  });
  return messageCount;
}

/** Abre (o crea con bienvenida) la conversacion de la sesion, bloqueada para este turno. */
async function openConversation(
  deps: ConversationDeps,
  request: ConversationRequest,
  config: ConversationConfig,
  now: Date,
): Promise<Opened> {
  const start = await startConversation(envFor(deps, request.tenantId, config, now), deps.steps);
  const { conversation, created } = await deps.conversations.open({
    id: deps.ids.next(),
    tenantId: request.tenantId,
    widgetSessionId: request.sessionId,
    state: start.state,
    now,
  });
  if (!created) {
    return { conversation, messageCount: conversation.messageCount };
  }
  const messageCount = await persist(deps, conversation, 0, start, config, now);
  return { conversation: { ...conversation, state: start.state }, messageCount };
}

export type GetConversation = (request: ConversationRequest) => Promise<HistoryView>;

export function createGetConversation(deps: ConversationDeps): GetConversation {
  return async (request) => {
    const now = deps.clock.now();
    const config = await deps.config(request.tenantId);
    const { conversation } = await openConversation(deps, request, config, now);
    const messages = await deps.messages.list(request.tenantId, conversation.id);
    const { context } = conversation.state;
    return { messages, options: renderOptions(context, config), input: context.input };
  };
}

export type HandleMessage = (
  request: ConversationRequest & { readonly message: IncomingMessage },
) => Promise<TurnView>;

export function createHandleMessage(deps: ConversationDeps): HandleMessage {
  return async (request) => {
    const now = deps.clock.now();
    const config = await deps.config(request.tenantId);
    const { conversation, messageCount } = await openConversation(deps, request, config, now);
    const { actorSubject, actorRole, requestId } = request;
    const effectContext = {
      tenantId: request.tenantId,
      conversationId: conversation.id,
      actor: { actorSubject, actorRole, requestId },
    };
    const output = await runTurn(
      conversation.state,
      request.message,
      envFor(deps, request.tenantId, config, now),
      (effect) => deps.runEffect(effect, effectContext),
      deps.steps,
    );
    await persist(deps, conversation, messageCount, output, config, now);
    const { context } = output.state;
    const messages = output.lines.map((l) => ({
      text: renderText(l.text, config),
      redacted: l.redacted === true,
    }));
    return { messages, options: renderOptions(context, config), input: context.input };
  };
}
