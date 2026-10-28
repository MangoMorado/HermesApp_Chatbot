import { describe, expect, it, vi } from "vitest";
import {
  createGetBotConfig,
  createUpdateBotConfig,
} from "@/modules/bot-config/application/bot-config";
import { createProvisionBotConfig } from "@/modules/bot-config/application/provisioning";
import { EMPTY_OVERRIDES } from "@/modules/bot-config/domain/bot-config";
import type {
  BotConfigRepository,
  WidgetKeyRepository,
} from "@/modules/bot-config/domain/ports/repositories";
import type { WidgetKey } from "@/modules/bot-config/domain/widget-key";
import { createCreateHandoffTicket } from "@/modules/handoff/application/create-handoff-ticket";
import { createServiceTokens } from "@/modules/hermes-simulator/application/service-tokens";
import { createPreRegisterPatient } from "@/modules/patients/application/pre-register-patient";
import { PRE_REGISTRATION_SYSTEM } from "@/modules/patients/domain/pre-registration";
import { createRegisterTenant } from "@/modules/platform/application/register-tenant";
import {
  createExpireDueRequests,
  createGetAppointmentRequest,
  createListAppointmentRequests,
} from "@/modules/scheduling/application/appointment-request-queries";
import type { AppointmentRequestView } from "@/modules/scheduling/domain/ports/pre-agenda";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { encodeCursor } from "@/modules/shared/domain/pagination";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import {
  createGetTenantSettings,
  createUpdateTenantSettings,
} from "@/modules/tenancy/application/tenant-settings";
import type { TenantSettings } from "@/modules/tenancy/domain/tenant-settings";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");
const ACTOR = { actorSubject: "admin", actorRole: "admin" as const, requestId: "r1" };
const audit = { record: vi.fn(async () => undefined) };
const clock = { now: () => NOW };
const ids = { next: () => "id-1" };

describe("cobertura: casos de uso application", () => {
  it("register-tenant crea tenant, aprovisiona y audita", async () => {
    const registry = {
      exists: vi.fn(),
      list: vi.fn(),
      create: vi.fn(async () => ({
        id: "t1",
        slug: "norte",
        name: "Norte",
        createdAt: NOW,
      })),
    };
    const provisioning = {
      provisionBotConfig: vi.fn(async () => ({ widgetKey: "wk_x" })),
      seedKnowledge: vi.fn(async () => undefined),
    };
    const credentials = { put: vi.fn(async () => undefined), get: vi.fn() };
    const register = createRegisterTenant({
      registry,
      provisioning,
      credentials,
      ids,
      audit,
      clock,
    });
    const result = await register({
      raw: { slug: "norte", name: "Norte", allowed_origins: ["https://a.example"] },
      actor: { subject: "ops", role: "platform" },
      requestId: "req-1",
    });
    expect(result).toEqual({
      tenant: { id: "t1", slug: "norte", name: "Norte", createdAt: NOW },
      widgetKey: "wk_x",
      widgetClientId: null,
    });
    expect(credentials.put).not.toHaveBeenCalled();
    expect(provisioning.provisionBotConfig).toHaveBeenCalledWith({
      tenantId: TENANT,
      allowedOrigins: ["https://a.example"],
    });
    expect(provisioning.seedKnowledge).toHaveBeenCalledWith(TENANT);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant.created", resourceId: "t1" }),
    );
  });

  it("provisioning crea config y clave vigente", async () => {
    const configs = {
      get: vi.fn(),
      create: vi.fn(async () => undefined),
      update: vi.fn(),
      lock: vi.fn(),
      isOriginRegistered: vi.fn(),
    };
    const keys = {
      listAccepted: vi.fn(),
      findByKey: vi.fn(),
      insert: vi.fn(async () => undefined),
      retire: vi.fn(),
    };
    const provision = createProvisionBotConfig({
      configs,
      keys,
      generator: { next: () => "wk_new" },
      ids,
      clock,
      originPolicy: { allowLocalhost: true },
    });
    await expect(
      provision({ tenantId: TENANT, allowedOrigins: ["http://localhost:3000"] }),
    ).resolves.toEqual({ widgetKey: "wk_new" });
    expect(configs.create).toHaveBeenCalledOnce();
    expect(keys.insert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "wk_new", tenantId: TENANT, retiredAt: null }),
    );
  });

  it("pre-register-patient inserta y audita", async () => {
    const repo = {
      insertPreRegistered: vi.fn(async () => undefined),
      insertActive: vi.fn(),
      updateFromHermes: vi.fn(),
      findByDocument: vi.fn(),
      findByIdentifier: vi.fn(),
      get: vi.fn(),
    };
    const register = createPreRegisterPatient({ repo, ids, clock, audit });
    const record = await register({
      ...ACTOR,
      tenantId: TENANT,
      data: {
        documentType: "CC",
        documentNumber: "1020304050",
        givenNames: "Ana",
        familyNames: "Perez",
        birthDate: "1990-03-07",
        phone: "3001234567",
        email: "ana@correo.com",
      },
    });
    expect(record).toMatchObject({
      id: "id-1",
      status: "pre_registered",
      identifier: { system: PRE_REGISTRATION_SYSTEM, value: "id-1" },
    });
    expect(repo.insertPreRegistered).toHaveBeenCalledWith(record);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "patient.pre_registered" }),
    );
  });

  it("create-handoff-ticket inserta y audita", async () => {
    const repo = { insert: vi.fn(async () => undefined) };
    const create = createCreateHandoffTicket({ repo, ids, clock, audit });
    const ticket = await create({
      ...ACTOR,
      tenantId: TENANT,
      conversationId: "c1",
      reason: "verification_locked",
      medicalRecordId: null,
    });
    expect(ticket).toMatchObject({
      id: "id-1",
      conversationId: "c1",
      reason: "verification_locked",
    });
    expect(repo.insert).toHaveBeenCalledWith(ticket);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "handoff.created", resourceType: "handoff_ticket" }),
    );
  });

  it("tenant-settings get/update y 404", async () => {
    const repo = {
      get: vi.fn(async (): Promise<TenantSettings | null> => ({ maxQueryRangeDays: 31 })),
      update: vi.fn(async (): Promise<TenantSettings | null> => ({ maxQueryRangeDays: 14 })),
    };
    const get = createGetTenantSettings(repo);
    await expect(get(TENANT)).resolves.toEqual({ maxQueryRangeDays: 31 });
    repo.get.mockResolvedValueOnce(null);
    await expect(get(TENANT)).rejects.toBeInstanceOf(NotFoundError);

    const update = createUpdateTenantSettings(repo, audit, clock);
    await expect(update({ tenantId: TENANT, maxQueryRangeDays: 14, ...ACTOR })).resolves.toEqual({
      maxQueryRangeDays: 14,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant_settings.updated" }),
    );
    repo.update.mockResolvedValueOnce(null);
    await expect(
      update({ tenantId: TENANT, maxQueryRangeDays: 14, ...ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("appointment-request-queries lista, obtiene y vence", async () => {
    const view: AppointmentRequestView = {
      id: "r1",
      tenantId: TENANT,
      kind: "book",
      status: "pending",
      medicalRecordId: "mr-1",
      slotId: "s1",
      appointmentId: null,
      expiresAt: NOW,
      resolutionReason: null,
      resultingAppointmentId: null,
      createdAt: NOW,
      resolvedAt: null,
      patient: {
        identifier: { system: "urn:hermes:patient", value: "1" },
        documentType: "CC",
        documentNumber: "1",
        givenNames: "Ana",
        familyNames: "Perez",
      },
      slot: null,
      appointment: null,
      resultingAppointment: null,
    };
    const page = { data: [view], nextCursor: null };
    const reader = {
      list: vi.fn(async () => page),
      get: vi.fn(async (): Promise<AppointmentRequestView | null> => view),
    };
    const expire = vi.fn(async () => undefined);
    const list = createListAppointmentRequests({ reader, expire });
    await expect(list({ tenantId: TENANT, cursor: null, limit: 50 })).resolves.toEqual(page);
    expect(expire).toHaveBeenCalledWith(TENANT);

    const cursor = encodeCursor({ key: NOW.toISOString(), id: "x" });
    await list({ tenantId: TENANT, cursor, limit: 10 });
    expect(reader.list).toHaveBeenCalledTimes(2);

    const get = createGetAppointmentRequest({ reader, expire });
    await expect(get(TENANT, "r1")).resolves.toEqual(view);
    reader.get.mockResolvedValueOnce(null);
    await expect(get(TENANT, "missing")).rejects.toBeInstanceOf(NotFoundError);

    const expirer = { expireDue: vi.fn(async () => undefined) };
    await createExpireDueRequests({ expirer, clock })(TENANT);
    expect(expirer.expireDue).toHaveBeenCalledWith(TENANT, NOW);
  });

  it("service-tokens pide al proveedor el token service del tenant", async () => {
    const source = {
      tokenFor: vi.fn(async () => ({ accessToken: "jwt", expiresAt: NOW })),
    };
    const tokens = createServiceTokens(source);
    await expect(tokens.issue(TENANT)).resolves.toBe("jwt");
    expect(source.tokenFor).toHaveBeenCalledWith({ kind: "service", tenantId: TENANT });
  });

  it("bot-config get/update con vista de claves", async () => {
    const key: WidgetKey = {
      id: "wk-1",
      tenantId: TENANT,
      key: `wk_${"a".repeat(43)}`,
      createdAt: NOW,
      retiredAt: null,
      graceUntil: null,
    };
    const configs: BotConfigRepository = {
      get: vi.fn(async () => EMPTY_OVERRIDES),
      create: vi.fn(),
      update: vi.fn(async () => true),
      lock: vi.fn(),
      isOriginRegistered: vi.fn(),
    };
    const keys: WidgetKeyRepository = {
      listAccepted: vi.fn(async () => [key]),
      findByKey: vi.fn(),
      insert: vi.fn(),
      retire: vi.fn(),
    };
    const get = createGetBotConfig({ configs, keys, clock });
    await expect(get(TENANT)).resolves.toMatchObject({
      currentKey: key,
      graceKey: null,
      config: expect.objectContaining({ allowedOrigins: [] }),
    });
    configs.get = vi.fn(async () => null);
    await expect(get(TENANT)).rejects.toBeInstanceOf(NotFoundError);

    configs.get = vi.fn(async () => EMPTY_OVERRIDES);
    const update = createUpdateBotConfig({
      configs,
      keys,
      clock,
      audit,
      originPolicy: { allowLocalhost: true },
    });
    await expect(
      update({
        ...ACTOR,
        tenantId: TENANT,
        patch: { texts: { welcome: "Hola" } },
      }),
    ).resolves.toMatchObject({ currentKey: key });
    expect(configs.update).toHaveBeenCalledOnce();
  });
});
