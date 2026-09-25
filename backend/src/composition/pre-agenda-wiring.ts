import type { PrismaClient } from "@prisma/client";
import { createExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createPrismaRequestExpirer } from "../modules/scheduling/infrastructure/prisma-pre-agenda-store";
import { systemClock } from "../modules/shared/infrastructure/system-clock";

/**
 * Cableado de la pre-agenda (3.2) y de la bandeja del simulador. Vive aparte para no
 * empujar `composition-root.ts` por encima del limite de lineas por archivo de logica.
 */

export function preAgendaReads(prisma: PrismaClient) {
  return {
    expireDueRequests: createExpireDueRequests({
      expirer: createPrismaRequestExpirer(prisma),
      clock: systemClock,
    }),
  };
}

export type PreAgendaReads = ReturnType<typeof preAgendaReads>;
