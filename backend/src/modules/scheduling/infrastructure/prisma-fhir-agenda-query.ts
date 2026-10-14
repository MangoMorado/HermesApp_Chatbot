import { Prisma } from "@prisma/client";
import type { PrismaExecutor } from "@/modules/shared/infrastructure/prisma-client";
import type {
  AgendaAppointmentSearch,
  AgendaAppointmentStatus,
  AgendaIdentifier,
  AgendaTimeBound,
} from "../domain/fhir-agenda";

export type AgendaKey = { readonly id: string; readonly source: string };

function appointmentBound(bound: AgendaTimeBound): Prisma.Sql {
  switch (bound.op) {
    case "ge":
      return Prisma.sql`a.start_at >= ${bound.at}`;
    case "gt":
      return Prisma.sql`a.start_at > ${bound.at}`;
    case "le":
      return Prisma.sql`a.start_at <= ${bound.at}`;
    case "lt":
      return Prisma.sql`a.start_at < ${bound.at}`;
  }
}

function slotBound(bound: AgendaTimeBound): Prisma.Sql {
  switch (bound.op) {
    case "ge":
      return Prisma.sql`s.start_at >= ${bound.at}`;
    case "gt":
      return Prisma.sql`s.start_at > ${bound.at}`;
    case "le":
      return Prisma.sql`s.start_at <= ${bound.at}`;
    case "lt":
      return Prisma.sql`s.start_at < ${bound.at}`;
  }
}

function firmBranch(search: AgendaAppointmentSearch): Prisma.Sql | null {
  if (search.status === "proposed") {
    return null;
  }
  const where = Prisma.join(
    [
      Prisma.sql`a.tenant_id = ${search.tenantId}`,
      ...firmFilters(search),
      ...search.start.map(appointmentBound),
    ],
    " AND ",
  );
  return Prisma.sql`
    SELECT a.id, a.start_at, 'firm' AS source
    FROM "public"."appointments" a
    WHERE ${where}`;
}

function firmFilters(search: AgendaAppointmentSearch): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];
  if (search.status !== null) {
    filters.push(Prisma.sql`a.status::text = ${search.status}`);
  }
  if (search.identifier !== null) {
    filters.push(Prisma.sql`a.identifier_system = ${search.identifier.system}`);
    filters.push(Prisma.sql`a.identifier_value = ${search.identifier.value}`);
  }
  if (search.medicalRecordId !== null) {
    filters.push(Prisma.sql`a.medical_record_id = ${search.medicalRecordId}`);
  }
  if (search.slotId !== null) {
    filters.push(Prisma.sql`a.slot_id = ${search.slotId}`);
  }
  return filters;
}

function requestBranch(search: AgendaAppointmentSearch, requestSystem: string): Prisma.Sql | null {
  const status = requestStatusSql(search.status);
  if (status === null) {
    return null;
  }
  const where = Prisma.join(
    [
      Prisma.sql`r.tenant_id = ${search.tenantId}`,
      Prisma.sql`r.kind::text IN ('book', 'reschedule')`,
      status,
      ...requestFilters(search, requestSystem),
      ...search.start.map(slotBound),
    ],
    " AND ",
  );
  return Prisma.sql`
    SELECT r.id, s.start_at, 'request' AS source
    FROM "public"."appointment_requests" r
    JOIN "public"."slots" s ON s.tenant_id = r.tenant_id AND s.id = r.slot_id
    WHERE ${where}`;
}

function requestStatusSql(status: AgendaAppointmentStatus | null): Prisma.Sql | null {
  if (status === "booked" || status === "fulfilled" || status === "noshow") {
    return null;
  }
  if (status === "proposed") {
    return Prisma.sql`r.status::text = 'pending'`;
  }
  if (status === "cancelled") {
    return Prisma.sql`r.status::text IN ('rejected', 'expired')`;
  }
  return Prisma.sql`r.status::text <> 'approved'`;
}

function requestFilters(search: AgendaAppointmentSearch, requestSystem: string): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];
  if (search.identifier !== null) {
    filters.push(requestIdentifierSql(search.identifier, requestSystem));
  }
  if (search.medicalRecordId !== null) {
    filters.push(Prisma.sql`r.medical_record_id = ${search.medicalRecordId}`);
  }
  if (search.slotId !== null) {
    filters.push(Prisma.sql`r.slot_id = ${search.slotId}`);
  }
  return filters;
}

function requestIdentifierSql(identifier: AgendaIdentifier, requestSystem: string): Prisma.Sql {
  if (identifier.system !== requestSystem) {
    return Prisma.sql`FALSE`;
  }
  return Prisma.sql`r.id = ${identifier.value}`;
}

function branches(search: AgendaAppointmentSearch, requestSystem: string): Prisma.Sql[] {
  return [firmBranch(search), requestBranch(search, requestSystem)].filter(
    (branch): branch is Prisma.Sql => branch !== null,
  );
}

/** Página ordenada por inicio e id. La unión se arma dos veces: Prisma no reutiliza un `Sql`. */
export async function pageAppointmentKeys(
  db: PrismaExecutor,
  search: AgendaAppointmentSearch,
  requestSystem: string,
): Promise<{ keys: AgendaKey[]; total: number }> {
  if (branches(search, requestSystem).length === 0) {
    return { keys: [], total: 0 };
  }
  const union = () => Prisma.join(branches(search, requestSystem), " UNION ALL ");
  const [keys, totals] = await Promise.all([
    db.$queryRaw<AgendaKey[]>`
      SELECT id, source, start_at FROM (${union()}) AS agenda
      ORDER BY start_at ASC, id ASC
      OFFSET ${search.offset} LIMIT ${search.limit}`,
    db.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM (${union()}) AS agenda`,
  ]);
  return { keys, total: Number(totals[0]?.total ?? 0) };
}
