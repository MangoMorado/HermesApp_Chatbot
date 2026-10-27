import type { ClosedSessions } from "@/modules/auth/domain/ports/closed-sessions";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";

export function createPrismaClosedSessions(db: PrismaExecutor): ClosedSessions {
  return {
    async close(providerSessionId, until) {
      await db.$executeRaw`
        INSERT INTO public.closed_provider_sessions (sid, closed_until)
        VALUES (${providerSessionId}, ${until})
        ON CONFLICT (sid) DO UPDATE
        SET closed_until = GREATEST(public.closed_provider_sessions.closed_until, EXCLUDED.closed_until)`;
    },
    async isClosed(providerSessionId, now) {
      const row = await db.closedProviderSession.findUnique({ where: { sid: providerSessionId } });
      return row !== null && row.closedUntil.getTime() > now.getTime();
    },
  };
}
