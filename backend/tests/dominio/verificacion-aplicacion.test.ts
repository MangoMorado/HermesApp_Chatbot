import { describe, expect, it, vi } from "vitest";
import {
  createOpenChallenge,
  createReadChallenge,
  createRecordVerificationAttempt,
} from "@/modules/verification/application/verification";
import type { Challenge } from "@/modules/verification/domain/challenge";
import type { ChallengeRepository } from "@/modules/verification/domain/ports";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");
const ACTOR = { actorSubject: "widget:s", actorRole: "widget" as const, requestId: "r1" };

const challenge = (overrides: Partial<Challenge> = {}): Challenge => ({
  id: "ch-1",
  tenantId: "t1",
  medicalRecordId: "mr-1",
  questionIds: ["birth_day", "birth_month"],
  failedAttempts: 0,
  lockedUntil: null,
  ...overrides,
});

function repo(overrides: Partial<ChallengeRepository> = {}): ChallengeRepository {
  return {
    find: vi.fn(async () => challenge()),
    insertIfAbsent: vi.fn(async () => undefined),
    findForUpdate: vi.fn(async () => challenge()),
    update: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("verificacion: casos de uso", () => {
  it("openChallenge guarda el par y devuelve el almacenado", async () => {
    const ports = repo();
    const open = createOpenChallenge({
      repo: ports,
      ids: { next: () => "ch-new" },
      clock: { now: () => NOW },
    });
    await expect(
      open({
        tenantId: TENANT,
        medicalRecordId: "mr-1",
        questionIds: ["birth_day", "phone_last_4"],
      }),
    ).resolves.toEqual(["birth_day", "birth_month"]);
    expect(ports.insertIfAbsent).toHaveBeenCalled();
  });

  it("openChallenge falla si no encuentra lo insertado", async () => {
    const open = createOpenChallenge({
      repo: repo({ find: vi.fn(async () => null) }),
      ids: { next: () => "ch-new" },
      clock: { now: () => NOW },
    });
    await expect(
      open({
        tenantId: TENANT,
        medicalRecordId: "mr-1",
        questionIds: ["birth_day", "birth_month"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("readChallenge aplica vencimiento al leer", async () => {
    const past = new Date("2026-06-15T07:00:00.000Z");
    const read = createReadChallenge({
      repo: repo({
        find: vi.fn(async () => challenge({ failedAttempts: 3, lockedUntil: past })),
      }),
      clock: { now: () => NOW },
    });
    await expect(read(TENANT, "mr-1")).resolves.toMatchObject({
      failedAttempts: 0,
      lockedUntil: null,
    });
  });

  it("recordAttempt verifica, audita y redibuja", async () => {
    const ports = repo();
    const audit = { record: vi.fn(async () => undefined) };
    const record = createRecordVerificationAttempt({
      repo: ports,
      clock: { now: () => NOW },
      random: { int: () => 0 },
      audit,
      policy: async () => ({ maxAttempts: 3, lockMinutes: 30 }),
      records: async () => ({
        id: "mr-1",
        birthDate: "1990-03-07",
        phone: "3001234567",
        email: "a@gmail.com",
      }),
    });
    const outcome = await record({
      tenantId: TENANT,
      medicalRecordId: "mr-1",
      success: true,
      ...ACTOR,
    });
    expect(outcome.result).toBe("verified");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "verification.succeeded" }),
    );
    expect(ports.update).toHaveBeenCalled();
  });

  it("recordAttempt falla si no hay challenge o expediente", async () => {
    const record = createRecordVerificationAttempt({
      repo: repo({ findForUpdate: vi.fn(async () => null) }),
      clock: { now: () => NOW },
      random: { int: () => 0 },
      audit: { record: vi.fn(async () => undefined) },
      policy: async () => ({ maxAttempts: 3, lockMinutes: 30 }),
      records: async () => ({
        id: "mr-1",
        birthDate: "1990-03-07",
        phone: null,
        email: null,
      }),
    });
    await expect(
      record({ tenantId: TENANT, medicalRecordId: "mr-1", success: false, ...ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
