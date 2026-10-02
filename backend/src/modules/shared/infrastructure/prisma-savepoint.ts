import type { PrismaExecutor } from "./prisma-client";

const SAVEPOINT = "conversation_effect";

/**
 * Ejecuta `run` dentro de un SAVEPOINT de la transaccion en curso. Si falla, vuelve al punto y
 * relanza: Postgres aborta la transaccion ante una sentencia rechazada (p. ej. P2002) y sin el
 * punto no se podria seguir escribiendo la conversacion (refinamiento 2).
 */
export async function withSavepoint<T>(db: PrismaExecutor, run: () => Promise<T>): Promise<T> {
  await db.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const result = await run();
    await db.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return result;
  } catch (error) {
    await db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    throw error;
  }
}
