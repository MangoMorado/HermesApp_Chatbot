import { afterAll, beforeAll, describe, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { PLATFORM_CASES } from "./contrato-rutas/cases-platform";
import { createContractValidator } from "./contrato-rutas/validator";
import { type ContractWorld, seedContractWorld } from "./contrato-rutas/world";
import { testPrisma } from "./support";

const prisma = testPrisma();
const validator = createContractValidator("platform");
let world: ContractWorld;

beforeAll(async () => {
  world = await seedContractWorld(prisma);
});

afterAll(async () => {
  resetContainer();
  await prisma.$disconnect();
});

describe("contrato-rutas: plataforma", () => {
  it.each(
    PLATFORM_CASES.map(
      (c) => [`${c.method.toUpperCase()} ${c.path} ${c.status} (${c.name})`, c] as const,
    ),
  )("%s", async (_label, c) => {
    await validator.check(c, await c.run(world));
  });
});
