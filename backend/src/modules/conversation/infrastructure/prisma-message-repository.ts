import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { MessageRepository } from "../domain/ports";

export function createPrismaMessageRepository(
  db: PrismaExecutor,
  ids: IdGenerator,
): MessageRepository {
  return {
    async append(input) {
      await db.conversationMessage.createMany({
        data: input.messages.map((message, index) => ({
          id: ids.next(),
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          seq: input.firstSeq + index,
          author: message.author,
          text: message.text,
          redacted: message.redacted,
          createdAt: input.now,
        })),
      });
    },

    list(tenantId, conversationId) {
      return db.conversationMessage.findMany({
        where: { tenantId, conversationId },
        orderBy: { seq: "asc" },
        select: { author: true, text: true, redacted: true, createdAt: true },
      });
    },
  };
}
