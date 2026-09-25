import { describe, expect, it } from "vitest";
import { createListAvailability } from "@/modules/scheduling/application/list-availability";
import { createListPractitioners } from "@/modules/scheduling/application/list-practitioners";
import type { Practitioner, Slot } from "@/modules/scheduling/domain/entities";
import type {
  PractitionerRepository,
  SlotRepository,
} from "@/modules/scheduling/domain/ports/repositories";
import { decodeCursor, encodeCursor, toPage } from "@/modules/shared/domain/pagination";
import { toTenantId } from "@/modules/shared/domain/tenant-id";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { TenantSettingsRepository } from "@/modules/tenancy/domain/ports/tenant-settings-repository";

const tenant = toTenantId("tenant-a");
const noExpiry = async () => {};

function fakePractitioners(rows: Practitioner[]): PractitionerRepository {
  return {
    async list(filter) {
      let data = rows.filter((row) => row.tenantId === filter.tenantId);
      if (filter.active !== undefined) {
        data = data.filter((row) => row.active === filter.active);
      }
      data.sort((a, b) => a.id.localeCompare(b.id));
      if (filter.cursor) {
        const position = decodeCursor(filter.cursor);
        data = data.filter((row) => row.id > position.id);
      }
      return toPage(data.slice(0, filter.limit + 1), filter.limit, (row) => ({
        key: row.id,
        id: row.id,
      }));
    },
  };
}

describe("dominio: listar profesionales", () => {
  it("filtra por active y pagina", async () => {
    const list = createListPractitioners(
      fakePractitioners([
        {
          id: "p1",
          tenantId: tenant,
          identifier: { system: "s", value: "1" },
          name: "A",
          active: true,
        },
        {
          id: "p2",
          tenantId: tenant,
          identifier: { system: "s", value: "2" },
          name: "B",
          active: false,
        },
      ]),
    );
    const page = await list({ tenantId: tenant, active: true, limitRaw: "50" });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.id).toBe("p1");
  });

  it("rechaza limit fuera de rango", async () => {
    const list = createListPractitioners(fakePractitioners([]));
    await expect(list({ tenantId: tenant, limitRaw: "999" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("dominio: disponibilidad", () => {
  it("aplica el tope de rango del tenant", async () => {
    const settings: TenantSettingsRepository = {
      get: async () => ({ maxQueryRangeDays: 7 }),
      update: async () => null,
    };
    const slots: SlotRepository = {
      listAvailability: async () => ({ data: [], nextCursor: null }),
      listBySchedule: async () => ({ data: [], nextCursor: null }),
    };
    const list = createListAvailability(slots, settings, noExpiry);
    await expect(
      list({
        tenantId: tenant,
        fromRaw: "2026-01-01",
        toRaw: "2026-02-01",
        timeZone: "America/Bogota",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("devuelve cupos free del rango", async () => {
    const slot: Slot = {
      id: "s1",
      tenantId: tenant,
      identifier: { system: "s", value: "1" },
      scheduleId: "sch1",
      startAt: new Date("2026-03-02T13:00:00.000Z"),
      endAt: new Date("2026-03-02T13:30:00.000Z"),
      status: "free",
    };
    const settings: TenantSettingsRepository = {
      get: async () => ({ maxQueryRangeDays: 31 }),
      update: async () => null,
    };
    const slots: SlotRepository = {
      listAvailability: async () => ({ data: [slot], nextCursor: null }),
      listBySchedule: async () => ({ data: [], nextCursor: null }),
    };
    const page = await createListAvailability(
      slots,
      settings,
      noExpiry,
    )({
      tenantId: tenant,
      fromRaw: "2026-03-01",
      toRaw: "2026-03-03",
      timeZone: "America/Bogota",
    });
    expect(page.data).toEqual([slot]);
    expect(encodeCursor({ key: slot.startAt.toISOString(), id: slot.id })).toEqual(
      expect.any(String),
    );
  });
});
