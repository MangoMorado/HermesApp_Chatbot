import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, type Page } from "@/modules/shared/domain/pagination";
import type { Clock } from "@/modules/shared/domain/ports/clock";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type {
  AppointmentRequestFilter,
  AppointmentRequestReader,
  AppointmentRequestView,
  RequestExpirer,
} from "../domain/ports/pre-agenda";

/** Vencimiento al leer; el barrido de la Fase 6 llamara a este mismo caso de uso. */
export type ExpireDueRequests = (tenantId: TenantId) => Promise<void>;

export function createExpireDueRequests(deps: {
  readonly expirer: RequestExpirer;
  readonly clock: Clock;
}): ExpireDueRequests {
  return (tenantId) => deps.expirer.expireDue(tenantId, deps.clock.now());
}

type QueryDeps = {
  readonly reader: AppointmentRequestReader;
  readonly expire: ExpireDueRequests;
};

export type ListAppointmentRequests = (
  filter: AppointmentRequestFilter,
) => Promise<Page<AppointmentRequestView>>;

export function createListAppointmentRequests(deps: QueryDeps): ListAppointmentRequests {
  return async (filter) => {
    if (filter.cursor) {
      decodeCursor(filter.cursor);
    }
    await deps.expire(filter.tenantId);
    return deps.reader.list(filter);
  };
}

export type GetAppointmentRequest = (
  tenantId: TenantId,
  id: string,
) => Promise<AppointmentRequestView>;

export function createGetAppointmentRequest(deps: QueryDeps): GetAppointmentRequest {
  return async (tenantId, id) => {
    await deps.expire(tenantId);
    const view = await deps.reader.get(tenantId, id);
    if (!view) {
      throw new NotFoundError();
    }
    return view;
  };
}
