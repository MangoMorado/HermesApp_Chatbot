import type { AuditActor } from "@/modules/shared/domain/audit-event";
import { ConflictError } from "@/modules/shared/domain/conflict-error";
import type { IdGenerator } from "@/modules/shared/domain/ports/id-generator";
import type { InboxRequest } from "../domain/inbox";
import type { ChatbotRequests, HermesSession } from "../domain/ports/inbox";
import { decide, undo } from "./inbox-decision";

export type InboxCommand = {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actor: AuditActor;
};

type ApproveDeps = {
  readonly chatbot: ChatbotRequests;
  readonly session: HermesSession;
  readonly ids: IdGenerator;
};

export function createListInbox(deps: { readonly chatbot: ChatbotRequests }) {
  return (filter: { tenantId: string; cursor: string | null; limit: number }) =>
    deps.chatbot.listPending(filter);
}

function assertPending(request: InboxRequest): void {
  if (request.status !== "pending") {
    throw new ConflictError("La solicitud ya no esta pendiente", {
      reason: "request_not_pending",
      status: request.status,
    });
  }
}

/**
 * Primero confirma Hermes y despues resuelve por FHIR. Si el PUT falla, deshace
 * lo que Hermes acaba de escribir.
 */
export function createApproveInboxRequest(deps: ApproveDeps) {
  return async (command: InboxCommand): Promise<InboxRequest> => {
    const request = await deps.chatbot.get(command.tenantId, command.requestId);
    assertPending(request);
    const write = await deps.session.run(async (store) => {
      const patientId = await store.findPatientId(command.tenantId, request.patient.identifier);
      if (!patientId) {
        throw new ConflictError("Hermes no conoce al paciente", {
          reason: "patient_not_in_hermes",
        });
      }
      return decide(deps.ids, store, command.tenantId, request, patientId);
    });
    try {
      return await deps.chatbot.resolve({ ...command, resolution: write.resolution });
    } catch (error) {
      await deps.session.run((store) => undo(store, command.tenantId, write));
      throw error;
    }
  };
}

export function createRejectInboxRequest(deps: { readonly chatbot: ChatbotRequests }) {
  return (command: InboxCommand): Promise<InboxRequest> =>
    deps.chatbot.resolve({ ...command, resolution: { outcome: "rejected", reason: "declined" } });
}
