import type { PrismaClient } from "@prisma/client";
import { signToken } from "../../helpers/idp";
import {
  ACTOR,
  clockAt,
  createRequest,
  HOUR_MS,
  seedWorld,
  slotAt,
  type World,
} from "../pre-agenda-support";
import type { ContractWorld } from "./world";

/** Clinicas con maestros en `public` y `hermes_sim` y cupos futuros (bandeja del simulador). */
export type SimSide = {
  readonly world: World;
  readonly sim: string;
  readonly admin: string;
};

export type SimContractWorld = ContractWorld & {
  readonly simA: SimSide;
  readonly simB: SimSide;
  readonly simOperatorA: string;
};

const FREE_SLOTS = 16;
const clock = clockAt(new Date());
let nextSlot = 0;

function futureStart(): Date {
  const start = new Date(Date.now() + 48 * HOUR_MS);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

async function seedSide(prisma: PrismaClient, slug: string): Promise<SimSide> {
  const world = await seedWorld(prisma, slug, futureStart(), { freeSlots: FREE_SLOTS });
  const admin = await signToken({ role: "admin", tenantId: world.tenantId });
  return { world, sim: `sim-${world.tenantId}`, admin };
}

export async function seedSimWorld(
  prisma: PrismaClient,
  base: ContractWorld,
): Promise<SimContractWorld> {
  nextSlot = 0;
  const simA = await seedSide(prisma, "sa");
  const simB = await seedSide(prisma, "sb");
  const simOperatorA = await signToken({ role: "operator", tenantId: simA.world.tenantId });
  return { ...base, simA, simB, simOperatorA };
}

/** Muchas pendientes del mismo paciente (el sembrado, que Hermes conoce): sin tope efectivo. */
const POLICY = { holdMinutes: 240, maxPendingHolds: 100 };

/** Solicitud pendiente nueva, cada una con su propio cupo libre. */
export async function pendingRequest(prisma: PrismaClient, side: SimSide): Promise<string> {
  const index = nextSlot++;
  const request = await createRequest(
    prisma,
    clock,
    {
      kind: "book",
      tenantId: side.world.tenantId,
      medicalRecordId: side.world.medicalRecordId,
      slotId: slotAt(side.world, index % FREE_SLOTS),
      actor: ACTOR,
    },
    POLICY,
  );
  return request.id;
}

export function simWorld(world: ContractWorld): SimContractWorld {
  const candidate = world as Partial<SimContractWorld>;
  if (!candidate.simA || !candidate.simB) {
    throw new Error("El caso del simulador necesita seedSimWorld");
  }
  return world as SimContractWorld;
}
