import type { PrismaClient } from "@prisma/client";
import { resetContainer } from "@/composition-root";
import { serviceToken } from "../../helpers/fhir";
import { platformToken, signToken } from "../../helpers/idp";
import { enableWidget, openChat, type WidgetChat } from "../chat-support";
import { seedTenantDomain, type TenantDomainSeed, truncateAll } from "../support";

export type WorldTenant = TenantDomainSeed & {
  readonly slug: string;
  readonly widgetKey: string;
  readonly knowledgeEntryId: string;
};

export type ContractWorld = {
  readonly prisma: PrismaClient;
  readonly tenantA: WorldTenant;
  readonly tenantB: WorldTenant;
  readonly tokens: {
    readonly adminA: string;
    readonly operatorA: string;
    readonly adminB: string;
    readonly platform: string;
    readonly serviceA: string;
  };
  readonly widgetA: WidgetChat;
};

async function seedTenant(prisma: PrismaClient, slug: string): Promise<WorldTenant> {
  const domain = await seedTenantDomain(prisma, slug);
  const widgetKey = await enableWidget(prisma, domain.tenantId, slug);
  const knowledgeEntryId = `${domain.tenantId}-kb`;
  await prisma.knowledgeEntry.create({
    data: {
      id: knowledgeEntryId,
      tenantId: domain.tenantId,
      category: "General",
      question: "¿Horario?",
      answer: "De 8 a 18.",
    },
  });
  return { ...domain, slug, widgetKey, knowledgeEntryId };
}

/**
 * Mundo sembrado una vez por archivo: dos clinicas con dominio, widget y una entrada de
 * conocimiento, tokens de cada rol y una conversacion abierta del widget en la clinica A.
 * Los ids quedan aqui para que los casos no consulten la base.
 */
export async function seedContractWorld(prisma: PrismaClient): Promise<ContractWorld> {
  await truncateAll(prisma);
  resetContainer();
  const tenantA = await seedTenant(prisma, "cra");
  const tenantB = await seedTenant(prisma, "crb");
  const tokens = {
    adminA: await signToken({ role: "admin", tenantId: tenantA.tenantId }),
    operatorA: await signToken({
      role: "operator",
      tenantId: tenantA.tenantId,
    }),
    adminB: await signToken({ role: "admin", tenantId: tenantB.tenantId }),
    platform: await platformToken(),
    serviceA: await serviceToken(tenantA.tenantId),
  };
  const widgetA = await openChat(tenantA.widgetKey);
  return { prisma, tenantA, tenantB, tokens, widgetA };
}
