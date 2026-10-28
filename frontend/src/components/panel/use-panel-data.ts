"use client";

import { useQuery } from "@tanstack/react-query";
import { getTenantSettings, listSchedules } from "@/api/default/default";
import type { Row } from "@/components/ui/board";
import { useSessionKey, useToken } from "@/lib/use-session";

type PageResult = { data?: Row[]; next_cursor?: string | null };

/** Lecturas que el panel necesita al abrir: ajustes del tenant y agendas activas. */
export function usePanelData() {
  const token = useToken();
  const session = useSessionKey();

  const settings = useQuery({
    queryKey: ["tenant-settings", session],
    queryFn: () => getTenantSettings(),
    enabled: Boolean(token),
    retry: false,
  });

  const schedules = useQuery({
    queryKey: ["schedules-active", session],
    queryFn: async () => (await listSchedules({ active: true })) as PageResult,
    enabled: Boolean(token),
    retry: false,
  });

  return { hasToken: Boolean(token), settings, schedules };
}
