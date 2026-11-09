import { afterAll, beforeAll, describe, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { SIM_CASES } from "./contrato-rutas/cases-sim";
import { seedSimWorld } from "./contrato-rutas/sim-world";
import { createContractValidator } from "./contrato-rutas/validator";
import { type ContractWorld, seedContractWorld } from "./contrato-rutas/world";
import { testPrisma } from "./support";

// El proyecto `db` ya enciende HERMES_SIMULATOR_ENABLED y la pasarela FHIR en modo handlers.
const prisma = testPrisma();
const validator = createContractValidator("sim");
let world: ContractWorld;

beforeAll(async () => {
  world = await seedSimWorld(prisma, await seedContractWorld(prisma));
});

afterAll(async () => {
  resetContainer();
  await prisma.$disconnect();
});

describe("contrato-rutas: simulador", () => {
  it.each(
    SIM_CASES.map(
      (c) => [`${c.method.toUpperCase()} ${c.path} ${c.status} (${c.name})`, c] as const,
    ),
  )("%s", async (_label, c) => {
    await validator.check(c, await c.run(world));
  });
});
