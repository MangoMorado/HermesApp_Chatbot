import type { Prisma } from "@prisma/client";
import { decodeCursor, toPage } from "@/modules/shared/domain/pagination";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type {
  AppointmentRequestReader,
  AppointmentRequestView,
  RequestPartyRef,
} from "../domain/ports/pre-agenda";
import { mapRequest } from "./prisma-pre-agenda-store";

const VIEW_INCLUDE = {
  medicalRecord: true,
  slot: true,
  appointment: true,
  resultingAppointment: true,
} as const satisfies Prisma.AppointmentRequestInclude;

type ViewRow = Prisma.AppointmentRequestGetPayload<{ include: typeof VIEW_INCLUDE }>;

type IdentifiedRow = { identifierSystem: string; identifierValue: string };

function identifierOf(row: IdentifiedRow) {
  return { system: row.identifierSystem, value: row.identifierValue };
}

function partyRef(
  row: (IdentifiedRow & { startAt: Date; endAt: Date }) | null,
): RequestPartyRef | null {
  return row ? { identifier: identifierOf(row), startAt: row.startAt, endAt: row.endAt } : null;
}

function mapView(row: ViewRow): AppointmentRequestView {
  return {
    ...mapRequest(row),
    patient: {
      identifier: identifierOf(row.medicalRecord),
      documentType: row.medicalRecord.documentType,
      documentNumber: row.medicalRecord.documentNumber,
      givenNames: row.medicalRecord.givenNames,
      familyNames: row.medicalRecord.familyNames,
    },
    slot: partyRef(row.slot),
    appointment: partyRef(row.appointment),
    resultingAppointment: row.resultingAppointment
      ? { identifier: identifierOf(row.resultingAppointment) }
      : null,
  };
}

/** Cursor (created_at ASC, id ASC). */
function afterCreatedAt(cursor: string | null | undefined) {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  const createdAt = new Date(position.key);
  return { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: position.id } }] };
}

export function createPrismaAppointmentRequestReader(db: PrismaExecutor): AppointmentRequestReader {
  return {
    async list(filter) {
      const rows = await db.appointmentRequest.findMany({
        where: {
          tenantId: filter.tenantId,
          ...(filter.status ? { status: filter.status } : {}),
          ...afterCreatedAt(filter.cursor),
        },
        include: VIEW_INCLUDE,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return toPage(rows.map(mapView), filter.limit, (view) => ({
        key: view.createdAt.toISOString(),
        id: view.id,
      }));
    },
    async get(tenantId, id) {
      const row = await db.appointmentRequest.findFirst({
        where: { tenantId, id },
        include: VIEW_INCLUDE,
      });
      return row ? mapView(row) : null;
    },
  };
}
