import { Prisma } from "@prisma/client";

/** Violacion de restriccion unica (P2002). La traduce cada adaptador a su error de dominio. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
