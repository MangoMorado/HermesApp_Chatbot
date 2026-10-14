import type { OffsetPage } from "@/modules/shared/domain/pagination";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type {
  AgendaAppointment,
  AgendaAppointmentSearch,
  AgendaIdentifier,
  AgendaTask,
  AgendaTaskSearch,
  AgendaTaskStatus,
  FhirAgenda,
} from "../domain/fhir-agenda";
import { type AgendaKey, pageAppointmentKeys } from "./prisma-fhir-agenda-query";

const FIRM_ACTORS = {
  schedule: { select: { practitionerId: true, healthcareServiceId: true } },
} as const;

const REQUEST_SLOT = {
  slot: {
    include: { schedule: { select: { practitionerId: true, healthcareServiceId: true } } },
  },
} as const;

type FirmRow = {
  id: string;
  identifierSystem: string;
  identifierValue: string;
  medicalRecordId: string;
  slotId: string;
  startAt: Date;
  endAt: Date;
  status: "booked" | "cancelled" | "fulfilled" | "noshow";
  schedule: { practitionerId: string; healthcareServiceId: string };
};

function fromFirm(row: FirmRow, replacesAppointmentId: string | null): AgendaAppointment {
  return {
    id: row.id,
    identifier: { system: row.identifierSystem, value: row.identifierValue },
    medicalRecordId: row.medicalRecordId,
    slotId: row.slotId,
    practitionerId: row.schedule.practitionerId,
    healthcareServiceId: row.schedule.healthcareServiceId,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    replacesAppointmentId,
  };
}

type RequestRow = {
  id: string;
  kind: "book" | "reschedule" | "cancel";
  status: "pending" | "approved" | "rejected" | "expired";
  medicalRecordId: string;
  slotId: string | null;
  appointmentId: string | null;
  slot: {
    id: string;
    startAt: Date;
    endAt: Date;
    schedule: { practitionerId: string; healthcareServiceId: string };
  } | null;
};

function fromRequest(row: RequestRow, requestSystem: string): AgendaAppointment {
  if (row.slot === null || row.slotId === null) {
    throw new Error("La solicitud de agenda no tiene cupo");
  }
  return {
    id: row.id,
    identifier: { system: requestSystem, value: row.id },
    medicalRecordId: row.medicalRecordId,
    slotId: row.slotId,
    practitionerId: row.slot.schedule.practitionerId,
    healthcareServiceId: row.slot.schedule.healthcareServiceId,
    startAt: row.slot.startAt,
    endAt: row.slot.endAt,
    status: row.status === "pending" ? "proposed" : "cancelled",
    replacesAppointmentId: row.kind === "reschedule" ? row.appointmentId : null,
  };
}

async function hydrate(
  db: PrismaExecutor,
  tenantId: TenantId,
  keys: readonly AgendaKey[],
  requestSystem: string,
): Promise<AgendaAppointment[]> {
  const firmIds = keys.filter((key) => key.source === "firm").map((key) => key.id);
  const requestIds = keys.filter((key) => key.source === "request").map((key) => key.id);
  const [firms, links, requests] = await Promise.all([
    firmIds.length === 0
      ? []
      : db.appointment.findMany({
          where: { tenantId, id: { in: firmIds } },
          include: FIRM_ACTORS,
        }),
    firmIds.length === 0
      ? []
      : db.appointmentRequest.findMany({
          where: { tenantId, kind: "reschedule", resultingAppointmentId: { in: firmIds } },
          select: { resultingAppointmentId: true, appointmentId: true },
        }),
    requestIds.length === 0
      ? []
      : db.appointmentRequest.findMany({
          where: { tenantId, id: { in: requestIds } },
          include: REQUEST_SLOT,
        }),
  ]);
  const byFirm = new Map(firms.map((row) => [row.id, fromFirm(row, replacesOf(links, row.id))]));
  const byRequest = new Map(
    requests.map((row) => [row.id, fromRequest(row, requestSystem)] as const),
  );
  return keys.map((key) => {
    const record = key.source === "firm" ? byFirm.get(key.id) : byRequest.get(key.id);
    if (!record) {
      throw new Error("Fila de agenda sin hidratar");
    }
    return record;
  });
}

function replacesOf(
  links: readonly { resultingAppointmentId: string | null; appointmentId: string | null }[],
  appointmentId: string,
): string | null {
  return links.find((link) => link.resultingAppointmentId === appointmentId)?.appointmentId ?? null;
}

function taskStatusOf(status: "pending" | "approved" | "rejected" | "expired"): AgendaTaskStatus {
  switch (status) {
    case "pending":
      return "requested";
    case "approved":
      return "completed";
    case "rejected":
      return "rejected";
    case "expired":
      return "cancelled";
  }
}

function storedTaskStatus(
  status: AgendaTaskStatus,
): "pending" | "approved" | "rejected" | "expired" {
  switch (status) {
    case "requested":
      return "pending";
    case "completed":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "expired";
  }
}

function fromCancel(
  row: {
    id: string;
    status: "pending" | "approved" | "rejected" | "expired";
    medicalRecordId: string;
    appointmentId: string | null;
    resolutionReason: "slot_unavailable" | "declined" | null;
  },
  requestSystem: string,
): AgendaTask | null {
  if (row.appointmentId === null) {
    return null;
  }
  return {
    id: row.id,
    identifier: { system: requestSystem, value: row.id },
    status: taskStatusOf(row.status),
    medicalRecordId: row.medicalRecordId,
    focusAppointmentId: row.appointmentId,
    statusReason: row.resolutionReason,
  };
}

function taskWhere(search: AgendaTaskSearch, requestSystem: string) {
  return {
    tenantId: search.tenantId,
    kind: "cancel" as const,
    ...(search.status === null ? {} : { status: storedTaskStatus(search.status) }),
    ...(search.focusAppointmentId === null ? {} : { appointmentId: search.focusAppointmentId }),
    ...(search.medicalRecordId === null ? {} : { medicalRecordId: search.medicalRecordId }),
    ...taskIdentifierWhere(search.identifier, requestSystem),
  };
}

function taskIdentifierWhere(identifier: AgendaIdentifier | null, requestSystem: string) {
  if (identifier === null) {
    return {};
  }
  if (identifier.system !== requestSystem) {
    return { id: { in: [] as string[] } };
  }
  return { id: identifier.value };
}

async function readAppointment(
  db: PrismaExecutor,
  requestSystem: string,
  tenantId: TenantId,
  id: string,
): Promise<AgendaAppointment | null> {
  const firm = await db.appointment.findFirst({
    where: { tenantId, id },
    include: FIRM_ACTORS,
  });
  if (firm) {
    const link = await db.appointmentRequest.findFirst({
      where: { tenantId, kind: "reschedule", resultingAppointmentId: id },
      select: { appointmentId: true },
    });
    return fromFirm(firm, link?.appointmentId ?? null);
  }
  const request = await db.appointmentRequest.findFirst({
    where: {
      tenantId,
      id,
      kind: { in: ["book", "reschedule"] },
      status: { not: "approved" },
    },
    include: REQUEST_SLOT,
  });
  return request ? fromRequest(request, requestSystem) : null;
}

async function searchAppointments(
  db: PrismaExecutor,
  requestSystem: string,
  search: AgendaAppointmentSearch,
): Promise<OffsetPage<AgendaAppointment>> {
  const { keys, total } = await pageAppointmentKeys(db, search, requestSystem);
  const data = await hydrate(db, search.tenantId, keys, requestSystem);
  return { data, total };
}

async function readTask(
  db: PrismaExecutor,
  requestSystem: string,
  tenantId: TenantId,
  id: string,
): Promise<AgendaTask | null> {
  const request = await db.appointmentRequest.findFirst({
    where: { tenantId, id, kind: "cancel" },
  });
  return request ? fromCancel(request, requestSystem) : null;
}

async function searchTasks(
  db: PrismaExecutor,
  requestSystem: string,
  search: AgendaTaskSearch,
): Promise<OffsetPage<AgendaTask>> {
  const where = taskWhere(search, requestSystem);
  const [rows, total] = await Promise.all([
    db.appointmentRequest.findMany({
      where,
      orderBy: [{ appointment: { startAt: "asc" } }, { id: "asc" }],
      skip: search.offset,
      take: search.limit,
    }),
    db.appointmentRequest.count({ where }),
  ]);
  const data = rows.flatMap((row) => {
    const task = fromCancel(row, requestSystem);
    return task ? [task] : [];
  });
  return { data, total };
}

/** Lectura unificada de la pre-agenda. El `requestSystem` lo elige el composition root. */
export function createPrismaFhirAgenda(db: PrismaExecutor, requestSystem: string): FhirAgenda {
  return {
    readAppointment: (tenantId, id) => readAppointment(db, requestSystem, tenantId, id),
    searchAppointments: (search) => searchAppointments(db, requestSystem, search),
    readTask: (tenantId, id) => readTask(db, requestSystem, tenantId, id),
    searchTasks: (search) => searchTasks(db, requestSystem, search),
  };
}
