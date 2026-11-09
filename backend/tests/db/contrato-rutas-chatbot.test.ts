import { afterAll, beforeAll, describe, it } from "vitest";
import { resetContainer } from "@/composition-root";
import { CHATBOT_PANEL_CASES } from "./contrato-rutas/cases-chatbot-panel";
import { CHATBOT_WIDGET_CASES } from "./contrato-rutas/cases-chatbot-widget";
import { createContractValidator } from "./contrato-rutas/validator";
import { type ContractWorld, seedContractWorld } from "./contrato-rutas/world";
import { testPrisma } from "./support";

const prisma = testPrisma();
const validator = createContractValidator("chatbot");
let world: ContractWorld;

beforeAll(async () => {
  world = await seedContractWorld(prisma);
});

afterAll(async () => {
  resetContainer();
  await prisma.$disconnect();
});

describe("contrato-rutas: chatbot", () => {
  it.each(
    [...CHATBOT_PANEL_CASES, ...CHATBOT_WIDGET_CASES].map(
      (c) => [`${c.method.toUpperCase()} ${c.path} ${c.status} (${c.name})`, c] as const,
    ),
  )("%s", async (_label, c) => {
    await validator.check(c, await c.run(world));
  });
});
