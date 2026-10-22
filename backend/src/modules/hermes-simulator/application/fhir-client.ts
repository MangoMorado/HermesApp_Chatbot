import { ConflictError } from "@/modules/shared/domain/conflict-error";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";
import { decodeCursor, encodeCursor, type Page } from "@/modules/shared/domain/pagination";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import type { InboxRequest, InboxResolution } from "../domain/inbox";
import type { FhirHttp, FhirHttpResponse, ServiceTokenIssuer } from "../domain/ports/fhir-http";
import type { ChatbotRequests } from "../domain/ports/inbox";
import {
  bookedAppointment,
  cancelledAppointment,
  completedTask,
  rejectedTask,
} from "./fhir-bodies";
import { fromAppointment, fromTask } from "./fhir-inbox-map";
import { asRecord, bundleEntries, bundleTotal } from "./fhir-json";

const PAGE_CAP = 20;

type Loader = (path: string) => Promise<Record<string, unknown>>;

function fail(response: FhirHttpResponse, action: string): never {
  if (response.status === 404) {
    throw new NotFoundError();
  }
  if (response.status === 409) {
    throw new ConflictError("La solicitud ya no esta pendiente", { reason: "request_not_pending" });
  }
  throw new Error(`${action} respondio ${response.status}`);
}

function offsetOf(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }
  const position = decodeCursor(cursor);
  const offset = Number(position.key);
  if (position.id !== "offset" || !Number.isInteger(offset) || offset < 0) {
    throw new ValidationError("cursor invalido", { field: "cursor" });
  }
  return offset;
}

function pageOf(rows: readonly InboxRequest[], offset: number, limit: number): Page<InboxRequest> {
  const data = rows.slice(offset, offset + limit);
  const next = offset + data.length < rows.length;
  return {
    data,
    nextCursor: next ? encodeCursor({ key: String(offset + data.length), id: "offset" }) : null,
  };
}

function byStartThenId(left: InboxRequest, right: InboxRequest): number {
  const start = left.expiresAt.getTime() - right.expiresAt.getTime();
  if (start !== 0) {
    return start;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

function resolutionKey(requestId: string, resolution: InboxResolution): string {
  if (resolution.outcome === "approved") {
    return `resolve:${requestId}:approved`;
  }
  return `resolve:${requestId}:rejected:${resolution.reason}`;
}

function resolutionBody(kind: "Appointment" | "Task", resolution: InboxResolution): unknown {
  if (kind === "Task") {
    return resolution.outcome === "approved" ? completedTask() : rejectedTask(resolution.reason);
  }
  if (resolution.outcome === "approved") {
    return bookedAppointment(resolution.appointmentIdentifier);
  }
  return cancelledAppointment(resolution.reason);
}

function overlay(request: InboxRequest, resolution: InboxResolution): InboxRequest {
  if (resolution.outcome === "approved") {
    return {
      ...request,
      status: "approved",
      resolutionReason: null,
      resultingAppointment: { identifier: resolution.appointmentIdentifier },
    };
  }
  return {
    ...request,
    status: "rejected",
    resolutionReason: resolution.reason,
    resultingAppointment: null,
  };
}

function assertLive(record: Record<string, unknown>, expected: string): void {
  const status = record.status;
  if (status !== expected) {
    throw new ConflictError("La solicitud ya no esta pendiente", {
      reason: "request_not_pending",
      status,
    });
  }
}

export function createFhirChatbotClient(deps: {
  readonly http: FhirHttp;
  readonly tokens: ServiceTokenIssuer;
}): ChatbotRequests {
  const { http, tokens } = deps;

  async function searchAll(token: string, query: string): Promise<unknown[]> {
    const found: unknown[] = [];
    let offset = 0;
    for (let page = 0; page < PAGE_CAP; page++) {
      const response = await http.request({
        method: "GET",
        path: `${query}&_count=200&_offset=${offset}`,
        token,
      });
      if (response.status !== 200) {
        fail(response, query);
      }
      const batch = bundleEntries(response.body);
      found.push(...batch);
      if (batch.length === 0 || found.length >= bundleTotal(response.body)) {
        return found;
      }
      offset += batch.length;
    }
    throw new Error(`La busqueda ${query} no termino`);
  }

  function loader(token: string): Loader {
    const cache = new Map<string, Promise<Record<string, unknown>>>();
    return (path) => {
      const cached = cache.get(path);
      if (cached) {
        return cached;
      }
      const pending = http.request({ method: "GET", path, token }).then((response) => {
        if (response.status !== 200) {
          fail(response, path);
        }
        return asRecord(response.body, path);
      });
      cache.set(path, pending);
      return pending;
    };
  }

  async function readOptional(
    token: string,
    path: string,
  ): Promise<Record<string, unknown> | null> {
    const response = await http.request({ method: "GET", path, token });
    if (response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      fail(response, path);
    }
    return asRecord(response.body, path);
  }

  async function putResource(
    token: string,
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    const response = await http.request({ method: "PUT", path, token, body, idempotencyKey });
    if (response.status !== 200 && response.status !== 201) {
      fail(response, path);
    }
    return asRecord(response.body, path);
  }

  async function listRows(token: string): Promise<InboxRequest[]> {
    const load = loader(token);
    const appointments = await searchAll(token, "Appointment?status=proposed");
    const tasks = await searchAll(token, "Task?status=requested");
    const rows: InboxRequest[] = [];
    for (const resource of appointments) {
      rows.push(await fromAppointment(load, asRecord(resource, "Appointment")));
    }
    for (const resource of tasks) {
      rows.push(await fromTask(load, asRecord(resource, "Task")));
    }
    return rows.sort(byStartThenId);
  }

  return {
    async listPending(filter) {
      const rows = await listRows(await tokens.issue(filter.tenantId));
      return pageOf(rows, offsetOf(filter.cursor), filter.limit);
    },
    async get(tenantId, id) {
      const token = await tokens.issue(tenantId);
      const load = loader(token);
      const appointment = await readOptional(token, `Appointment/${id}`);
      if (appointment) {
        return fromAppointment(load, appointment);
      }
      const task = await readOptional(token, `Task/${id}`);
      if (!task) {
        throw new NotFoundError();
      }
      return fromTask(load, task);
    },
    async resolve(input) {
      const token = await tokens.issue(input.tenantId);
      const load = loader(token);
      const path = `Appointment/${input.requestId}`;
      const appointment = await readOptional(token, path);
      if (appointment) {
        assertLive(appointment, "proposed");
        const body = await putResource(
          token,
          path,
          resolutionBody("Appointment", input.resolution),
          resolutionKey(input.requestId, input.resolution),
        );
        return overlay(await fromAppointment(load, body), input.resolution);
      }
      const taskPath = `Task/${input.requestId}`;
      const task = await readOptional(token, taskPath);
      if (!task) {
        throw new NotFoundError();
      }
      assertLive(task, "requested");
      const body = await putResource(
        token,
        taskPath,
        resolutionBody("Task", input.resolution),
        resolutionKey(input.requestId, input.resolution),
      );
      return overlay(await fromTask(load, body), input.resolution);
    },
  };
}
