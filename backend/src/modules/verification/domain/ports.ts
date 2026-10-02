import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { Challenge, VerificationPolicy } from "./challenge";

export type ChallengeRepository = {
  find(tenantId: TenantId, medicalRecordId: string): Promise<Challenge | null>;
  /** INSERT ... ON CONFLICT DO NOTHING: si otra sesion ya guardo un par, gana el suyo. */
  insertIfAbsent(challenge: Challenge, now: Date): Promise<void>;
  /** SELECT ... FOR UPDATE: serializa intentos simultaneos del mismo expediente. */
  findForUpdate(tenantId: TenantId, medicalRecordId: string): Promise<Challenge | null>;
  update(challenge: Challenge, now: Date): Promise<void>;
};

/** Parametros de bot-config (verification_max_attempts, verification_lock_minutes). */
export type VerificationPolicyReader = (tenantId: TenantId) => Promise<VerificationPolicy>;
