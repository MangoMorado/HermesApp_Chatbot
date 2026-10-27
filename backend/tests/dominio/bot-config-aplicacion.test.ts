import { describe, expect, it, vi } from "vitest";
import { createAddAllowedOrigin, createRemoveAllowedOrigin } from "@/modules/bot-config/application/allowed-origins";
import { createReadBotParams, createResolveWidgetKey } from "@/modules/bot-config/application/widget-access";
import { createRotateWidgetKey } from "@/modules/bot-config/application/widget-keys";
import { EMPTY_OVERRIDES } from "@/modules/bot-config/domain/bot-config";
import type {
  BotConfigRepository,
  WidgetKeyRepository,
} from "@/modules/bot-config/domain/ports/repositories";
import type { WidgetKey } from "@/modules/bot-config/domain/widget-key";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { toTenantId } from "@/modules/shared/domain/tenant-id";

const NOW = new Date("2026-06-15T08:00:00.000Z");
const TENANT = toTenantId("t1");
const ACTOR = { actorSubject: "admin", actorRole: "admin" as const, requestId: "r1" };
const KEY = `wk_${"a".repeat(43)}`;

const widgetKey = (overrides: Partial<WidgetKey> = {}): WidgetKey => ({
  id: "wk-1",
  tenantId: TENANT,
  key: KEY,
  createdAt: NOW,
  retiredAt: null,
  graceUntil: null,
  ...overrides,
});

function configs(overrides: Partial<BotConfigRepository> = {}): BotConfigRepository {
  return {
    get: vi.fn(async () => EMPTY_OVERRIDES),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => true),
    lock: vi.fn(async () => true),
    isOriginRegistered: vi.fn(async () => false),
    ...overrides,
  };
}

function keys(overrides: Partial<WidgetKeyRepository> = {}): WidgetKeyRepository {
  return {
    listAccepted: vi.fn(async () => [widgetKey()]),
    findByKey: vi.fn(async () => widgetKey()),
    insert: vi.fn(async () => undefined),
    retire: vi.fn(async () => undefined),
    ...overrides,
  };
}

const audit = { record: vi.fn(async () => undefined) };
const clock = { now: () => NOW };
const originPolicy = { allowLocalhost: true };

describe("conocimiento-config: widget-access", () => {
  it("resuelve clave valida al tenant y params efectivos", async () => {
    const resolve = createResolveWidgetKey({ configs: configs(), keys: keys() });
    await expect(resolve(KEY, NOW)).resolves.toMatchObject({
      tenantId: TENANT,
      allowedOrigins: [],
      params: expect.objectContaining({ widget_session_ttl_minutes: 30 }),
    });
  });

  it("devuelve null si el formato, la clave o el config fallan", async () => {
    const resolve = createResolveWidgetKey({ configs: configs(), keys: keys() });
    await expect(resolve("mala", NOW)).resolves.toBeNull();

    const retired = createResolveWidgetKey({
      configs: configs(),
      keys: keys({
        findByKey: vi.fn(async () =>
          widgetKey({ retiredAt: NOW, graceUntil: new Date(NOW.getTime() - 1) }),
        ),
      }),
    });
    await expect(retired(KEY, NOW)).resolves.toBeNull();

    const noConfig = createResolveWidgetKey({
      configs: configs({ get: vi.fn(async () => null) }),
      keys: keys(),
    });
    await expect(noConfig(KEY, NOW)).resolves.toBeNull();
  });

  it("readBotParams exige bot-config", async () => {
    const read = createReadBotParams(configs());
    await expect(read(TENANT)).resolves.toMatchObject({ kb_max_results: 3 });
    await expect(createReadBotParams(configs({ get: vi.fn(async () => null) }))(TENANT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("conocimiento-config: origenes y rotacion", () => {
  it("agrega y quita origen con fila bloqueada", async () => {
    const ports = configs();
    const keyPorts = keys();
    const add = createAddAllowedOrigin({
      configs: ports,
      keys: keyPorts,
      clock,
      audit,
      originPolicy,
    });
    const view = await add({
      tenantId: TENANT,
      origin: "https://clinica.test",
      ...ACTOR,
    });
    expect(ports.update).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ allowedOrigins: ["https://clinica.test"] }),
    );
    expect(view.config.allowedOrigins).toEqual(["https://clinica.test"]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bot_config.origin_added" }),
    );

    const remove = createRemoveAllowedOrigin({
      configs: configs({
        get: vi.fn(async () => ({
          ...EMPTY_OVERRIDES,
          allowedOrigins: ["https://clinica.test"],
        })),
      }),
      keys: keyPorts,
      clock,
      audit,
      originPolicy,
    });
    const after = await remove({
      tenantId: TENANT,
      origin: "https://clinica.test",
      ...ACTOR,
    });
    expect(after.config.allowedOrigins).toEqual([]);
  });

  it("falla al cambiar origen si no hay fila", async () => {
    const add = createAddAllowedOrigin({
      configs: configs({ lock: vi.fn(async () => false) }),
      keys: keys(),
      clock,
      audit,
      originPolicy,
    });
    await expect(
      add({ tenantId: TENANT, origin: "https://a.test", ...ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rota la clave vigente a gracia e inserta una nueva", async () => {
    const keyPorts = keys();
    const rotate = createRotateWidgetKey({
      configs: configs(),
      keys: keyPorts,
      generator: { next: () => `wk_${"b".repeat(43)}` },
      ids: { next: () => "wk-new" },
      audit,
      clock,
    });
    const view = await rotate({ tenantId: TENANT, ...ACTOR });
    expect(keyPorts.retire).toHaveBeenCalled();
    expect(keyPorts.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wk-new", key: `wk_${"b".repeat(43)}` }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "widget_key.rotated" }),
    );
    expect(view.currentKey?.id).toBe("wk-1");
  });
});
