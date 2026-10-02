import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type { HandoffRepository } from "../domain/ports";

export function createPrismaHandoffRepository(db: PrismaExecutor): HandoffRepository {
  return {
    async insert(ticket) {
      await db.handoffTicket.create({
        data: {
          id: ticket.id,
          tenantId: ticket.tenantId,
          conversationId: ticket.conversationId,
          reason: ticket.reason,
          medicalRecordId: ticket.medicalRecordId,
          createdAt: ticket.createdAt,
        },
      });
    },
  };
}
