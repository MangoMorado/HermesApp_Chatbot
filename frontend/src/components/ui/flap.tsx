import type { CSSProperties } from "react";

type Tone = "ok" | "hold" | "busy" | "off" | "info";

/**
 * Traducción de presentación: el backend resuelve el estado; aquí solo se
 * elige cómo se lee en el tablero. Un estado desconocido se muestra tal cual.
 */
const STATUS: Record<string, { readonly label: string; readonly tone: Tone }> = {
  free: { label: "LIBRE", tone: "ok" },
  busy_tentative: { label: "TENTATIVO", tone: "hold" },
  busy: { label: "OCUPADO", tone: "busy" },
  busy_unavailable: { label: "NO DISPONIBLE", tone: "off" },
  booked: { label: "AGENDADA", tone: "info" },
  fulfilled: { label: "ATENDIDA", tone: "info" },
  cancelled: { label: "CANCELADA", tone: "off" },
  noshow: { label: "NO ASISTIÓ", tone: "busy" },
  active: { label: "ACTIVO", tone: "info" },
  pre_registered: { label: "PRE-REGISTRO", tone: "hold" },
  true: { label: "ACTIVA", tone: "info" },
  false: { label: "INACTIVA", tone: "off" },
  session_on: { label: "EN SESIÓN", tone: "info" },
  session_off: { label: "SIN SESIÓN", tone: "off" },
  session_rejected: { label: "RECHAZADO", tone: "busy" },
};

type Props = {
  readonly status: string;
  /** Posición de la fila: escalona el volteo de las paletas. */
  readonly row?: number;
};

/**
 * Paleta split-flap: único portador de color de estado en todo el producto.
 * Verde solo para LIBRE, ámbar para tentativo, rosa para ocupado; lo demás es lavanda o gris.
 */
export function Flap({ status, row = 0 }: Props) {
  const known = STATUS[status];
  const style = { "--row": row } as CSSProperties;
  return (
    <span className="flap" data-tone={known?.tone ?? "off"} style={style} title={status}>
      {known?.label ?? status.toUpperCase()}
    </span>
  );
}
