import type { AuditActor } from "@/modules/shared/domain/audit-event";
import type { TenantId } from "@/modules/shared/domain/tenant-id";
import { assertAppointmentEcho, assertTaskEcho } from "../domain/echo-agenda";
import { fhirConflict, fhirInvalid, fhirNotFound } from "../domain/fhir-error";
import { toAppointment } from "../domain/mappers/appointment";
import { toTask } from "../domain/mappers/task";
import {
  type AppointmentResolutionBody,
  parseAppointmentResolution,
} from "../domain/parsers/appointment-resolution";
import { parseTaskResolution, type TaskResolutionBody } from "../domain/parsers/task-resolution";
import type { AgendaResolution, AgendaResolver } from "../domain/ports/agenda";
import { APPOINTMENT_REQUEST_SYSTEM, type ResolutionReasonCode } from "../domain/profiles";
import type { FhirResource } from "../domain/resources/types";

export type ResolveByIdInput = {
  readonly tenantId: TenantId;
  readonly actor: AuditActor;
  readonly type: "Appointment" | "Task";
  readonly id: string;
  readonly body: unknown;
};

export function createResolveById(resolver: AgendaResolver) {
  return async (input: ResolveByIdInput): Promise<FhirResource> => {
    await resolver.expire(input.tenantId);
    if (input.type === "Task") {
      return resolveTask(resolver, input);
    }
    return resolveAppointment(resolver, input);
  };
}

async function resolveAppointment(
  resolver: AgendaResolver,
  input: ResolveByIdInput,
): Promise<FhirResource> {
  const parsed = parseAppointmentResolution(input.body);
  assertSameId(parsed.bodyId, input.id);
  const current = await resolver.readAppointment(input.tenantId, input.id);
  assertProposed(current);
  assertAppointmentEcho(parsed, current);
  await resolver.resolve({
    tenantId: input.tenantId,
    actor: input.actor,
    requestId: input.id,
    kind: "agenda",
    resolution: appointmentResolution(parsed),
  });
  return toAppointment(await rereadAppointment(resolver, input));
}

async function resolveTask(
  resolver: AgendaResolver,
  input: ResolveByIdInput,
): Promise<FhirResource> {
  const parsed = parseTaskResolution(input.body);
  assertSameId(parsed.bodyId, input.id);
  const current = await resolver.readTask(input.tenantId, input.id);
  if (current?.status !== "requested") {
    throw current ? fhirConflict("La solicitud ya no esta pendiente") : fhirNotFound();
  }
  assertTaskEcho(parsed, current);
  await resolver.resolve({
    tenantId: input.tenantId,
    actor: input.actor,
    requestId: input.id,
    kind: "cancel",
    resolution: taskResolution(parsed, input.id),
  });
  const next = await resolver.readTask(input.tenantId, input.id);
  if (!next) {
    throw fhirNotFound();
  }
  return toTask(next);
}

function assertProposed(
  current: Awaited<ReturnType<AgendaResolver["readAppointment"]>>,
): asserts current is NonNullable<typeof current> {
  if (current?.status !== "proposed") {
    throw current ? fhirConflict("La solicitud ya no esta pendiente") : fhirNotFound();
  }
}

async function rereadAppointment(
  resolver: AgendaResolver,
  input: ResolveByIdInput,
): Promise<NonNullable<Awaited<ReturnType<AgendaResolver["readAppointment"]>>>> {
  const next = await resolver.readAppointment(input.tenantId, input.id);
  if (!next) {
    throw fhirNotFound();
  }
  return next;
}

function assertSameId(bodyId: string | null, id: string): void {
  if (bodyId !== null && bodyId !== id) {
    throw fhirInvalid("El id del cuerpo no coincide con el recurso");
  }
}

function appointmentResolution(parsed: AppointmentResolutionBody): AgendaResolution {
  if (parsed.status === "cancelled") {
    return { outcome: "rejected", reason: parsed.reason ?? "declined" };
  }
  if (parsed.businessIdentifier === null) {
    throw fhirInvalid("identifier de negocio es obligatorio");
  }
  return { outcome: "approved", appointmentIdentifier: parsed.businessIdentifier };
}

function taskResolution(parsed: TaskResolutionBody, requestId: string): AgendaResolution {
  if (parsed.status === "rejected") {
    return { outcome: "rejected", reason: reasonOf(parsed.reason) };
  }
  return {
    outcome: "approved",
    appointmentIdentifier: { system: APPOINTMENT_REQUEST_SYSTEM, value: requestId },
  };
}

function reasonOf(reason: ResolutionReasonCode | null): ResolutionReasonCode {
  return reason ?? "declined";
}
