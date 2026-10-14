import type { PrismaClient } from "@prisma/client";
import type { HermesSession } from "../domain/ports/inbox";
import { createPrismaSimInboxStore } from "./prisma-inbox-store";

/** Confirma en `hermes_sim` antes de que el cliente hable con `/fhir`. */
export function createPrismaHermesSession(prisma: PrismaClient): HermesSession {
  return {
    run: (fn) => prisma.$transaction((tx) => fn(createPrismaSimInboxStore(tx))),
  };
}
