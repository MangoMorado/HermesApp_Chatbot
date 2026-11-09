"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ErrorBox } from "@/components/error-box";
import { Board, type Column, type Row } from "@/components/ui/board";
import { When } from "@/components/ui/cells";
import { ApiClientError } from "@/lib/api-fetcher";
import { text } from "@/lib/format";
import { idempotent } from "@/lib/idempotency";
import { useAction } from "@/lib/use-action";
import { useSessionKey, useToken } from "@/lib/use-session";
import { approveSimInboxRequest, listSimInbox, rejectSimInboxRequest } from "@/sim/default/default";
import type { InboxRequest } from "@/sim/models";

const PAGE_SIZE = 50;

type Verb = "approve" | "reject";

/** Traducción de presentación del tipo de solicitud. */
const KIND: Record<string, string> = {
  book: "Agendar",
  reschedule: "Reprogramar",
  cancel: "Cancelar",
};

function toRow(request: InboxRequest): Row {
  const { patient } = request;
  return {
    id: request.id,
    kind: KIND[request.kind] ?? request.kind,
    patient: `${patient.given_names} ${patient.family_names}`,
    document: `${patient.document_type} ${patient.document_number}`,
    when: request.slot?.start_at ?? request.appointment?.start_at ?? null,
    expires_at: request.expires_at,
  };
}

function columns(decide: (verb: Verb, id: string) => void, pending: string | null): Column[] {
  return [
    { header: "Tipo", width: "1%", render: (row) => text(row, "kind") },
    {
      header: "Paciente",
      render: (row) => (
        <>
          <div>{text(row, "patient")}</div>
          <div className="cell-muted data">{text(row, "document")}</div>
        </>
      ),
    },
    { header: "Cupo o cita", render: (row) => <When value={row.when} /> },
    { header: "Vence", optional: true, render: (row) => <When value={row.expires_at} /> },
    {
      header: "Resolver",
      width: "1%",
      render: (row) => {
        const id = text(row, "id");
        return (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={pending !== null}
              aria-busy={pending === `approve:${id}`}
              onClick={() => decide("approve", id)}
            >
              Aprobar
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              disabled={pending !== null}
              aria-busy={pending === `reject:${id}`}
              onClick={() => decide("reject", id)}
            >
              Rechazar
            </button>
          </div>
        );
      },
    },
  ];
}

function idleMessage(error: unknown, hasToken: boolean): { title: string; hint: string } {
  if (error instanceof ApiClientError && error.status === 404) {
    return {
      title: "Simulador apagado en este entorno",
      hint: "Requiere HERMES_SIMULATOR_ENABLED=true en el backend.",
    };
  }
  if (error) {
    return { title: "No se pudo listar", hint: "Revisa el aviso de arriba y vuelve a intentarlo." };
  }
  return hasToken
    ? { title: "Cargando la bandeja…", hint: "Consultando las solicitudes pendientes." }
    : { title: "Sin sesión", hint: "Inicia sesión como admin en la franja de sesión (tecla 0)." };
}

/** Solicitudes pendientes de pre-agenda: Hermes (simulado) las aprueba o las rechaza. */
export function InboxBoard() {
  const token = useToken();
  const sessionKey = useSessionKey();
  const list = useInfiniteQuery({
    queryKey: ["sim-inbox", sessionKey],
    queryFn: ({ pageParam }) =>
      listSimInbox({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(token),
    retry: false,
  });
  const { pending, error, run } = useAction();
  const decide = (verb: Verb, id: string) =>
    run(`${verb}:${id}`, async () => {
      const resolve = verb === "approve" ? approveSimInboxRequest : rejectSimInboxRequest;
      await resolve(id, idempotent(`inbox.${verb}:${id}`, {}));
      await list.refetch();
    });
  const rows = list.data ? list.data.pages.flatMap((page) => page.data.map(toRow)) : null;
  return (
    <section className="board" aria-label="Bandeja de solicitudes">
      <div className="board-head">
        <div className="board-title">
          <h2>Pendientes</h2>
          <div className="row-actions">
            {list.hasNextPage ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                Cargar más
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              disabled={!token || list.isFetching}
              onClick={() => list.refetch()}
            >
              Recargar
            </button>
          </div>
        </div>
        <ErrorBox error={error ?? list.error} />
      </div>
      <Board
        columns={columns(decide, pending)}
        rows={rows}
        loading={list.isLoading}
        more={Boolean(list.hasNextPage)}
        idle={idleMessage(list.error, Boolean(token))}
        empty={{
          title: "Sin solicitudes pendientes",
          hint: "Las que cree el chat aparecerán aquí hasta resolverse o vencer.",
        }}
      />
    </section>
  );
}
