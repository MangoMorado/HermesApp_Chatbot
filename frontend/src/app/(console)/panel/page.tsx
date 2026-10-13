"use client";

import { useState } from "react";
import { AgendaBoard } from "@/components/panel/agenda-board";
import { RecordLookup } from "@/components/panel/record-lookup";
import { SchedulesBoard } from "@/components/panel/schedules-board";
import { usePanelData } from "@/components/panel/use-panel-data";

export default function PanelPage() {
  const { hasToken, settings, schedules } = usePanelData();
  const [scheduleId, setScheduleId] = useState("");
  const maxDays = settings.data?.max_query_range_days ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Panel</h1>
          <p>
            Agenda del tenant, cupos libres y expedientes. Hermes confirma las citas; aquí solo se
            leen.
          </p>
        </div>
        <p className="page-meta">
          <span>
            Tope de rango <strong className="data">{maxDays ?? "—"}</strong> días
          </span>
        </p>
      </div>
      <div className="split">
        <AgendaBoard
          schedules={schedules.data?.data ?? []}
          scheduleId={scheduleId}
          onScheduleChange={setScheduleId}
          maxDays={maxDays}
        />
        <div className="column">
          <SchedulesBoard
            rows={hasToken ? (schedules.data?.data ?? null) : null}
            loading={schedules.isFetching}
            error={schedules.error ?? settings.error}
            more={Boolean(schedules.data?.next_cursor)}
            pickedId={scheduleId}
            onPick={setScheduleId}
            onReload={() => schedules.refetch()}
          />
          <RecordLookup />
        </div>
      </div>
    </>
  );
}
