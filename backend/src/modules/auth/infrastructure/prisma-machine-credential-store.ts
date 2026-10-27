import type { MachineCredentialStore } from "@/modules/auth/domain/ports/machine-credentials";
import type { SecretBox } from "@/modules/shared/domain/ports/secret-box";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";

/** El secreto del cliente se guarda sellado con SecretBox; nunca en claro. */
export function createPrismaMachineCredentialStore(
  db: PrismaExecutor,
  box: SecretBox,
): MachineCredentialStore {
  return {
    async put(tenantId, kind, credential, now) {
      const secretSealed = box.seal(credential.clientSecret);
      await db.machineCredential.upsert({
        where: { tenantId_kind: { tenantId, kind } },
        create: {
          tenantId,
          kind,
          clientId: credential.clientId,
          secretSealed,
          createdAt: now,
          updatedAt: now,
        },
        update: { clientId: credential.clientId, secretSealed, updatedAt: now },
      });
    },
    async get(tenantId, kind) {
      const row = await db.machineCredential.findUnique({
        where: { tenantId_kind: { tenantId, kind } },
      });
      return row ? { clientId: row.clientId, clientSecret: box.open(row.secretSealed) } : null;
    },
  };
}
