import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "@prisma/client";

/** Cliente o transaccion: los adaptadores aceptan ambos para componer transacciones. */
export type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

/** Unico lugar que construye clientes Prisma (Prisma 7 exige adaptador de driver). */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
