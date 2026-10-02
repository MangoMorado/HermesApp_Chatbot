import type { Prisma } from "@prisma/client";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { ConversationRepository, StoredConversation } from "../domain/ports";
import type { ConversationContext, ConversationState, StepId } from "../domain/types";

function toStored(row: {
  id: string;
  tenantId: string;
  widgetSessionId: string;
  step: string;
  context: Prisma.JsonValue;
  messageCount: number;
}): StoredConversation {
  const state: ConversationState = {
    step: row.step as StepId,
    context: row.context as unknown as ConversationContext,
  };
  return {
    id: row.id,
    tenantId: row.tenantId,
    widgetSessionId: row.widgetSessionId,
    state,
    messageCount: row.messageCount,
  };
}

const asJson = (context: ConversationContext) => context as unknown as Prisma.InputJsonValue;

export function createPrismaConversationRepository(db: PrismaExecutor): ConversationRepository {
  return {
    async open(input) {
      const { tenantId, widgetSessionId } = input;
      const inserted = await db.conversation.createMany({
        data: [
          {
            id: input.id,
            tenantId,
            widgetSessionId,
            step: input.state.step,
            context: asJson(input.state.context),
            createdAt: input.now,
            updatedAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
      await db.$queryRaw`
        SELECT "id" FROM "public"."conversations"
        WHERE "tenant_id" = ${tenantId} AND "widget_session_id" = ${widgetSessionId} FOR UPDATE`;
      const row = await db.conversation.findUniqueOrThrow({
        where: { tenantId_widgetSessionId: { tenantId, widgetSessionId } },
      });
      return { conversation: toStored(row), created: inserted.count === 1 };
    },

    async save(input) {
      await db.conversation.update({
        where: { id: input.id },
        data: {
          step: input.state.step,
          context: asJson(input.state.context),
          medicalRecordId: input.medicalRecordId,
          messageCount: input.messageCount,
          updatedAt: input.now,
        },
      });
    },
  };
}
