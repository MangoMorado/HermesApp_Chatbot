import { WidgetApiError } from "./fetcher";

/** Lo que ve el paciente ante un fallo de transporte: nunca códigos ni `request_id`. */
export type Failure = {
  readonly text: string;
  /** Sin reintento posible (sitio no autorizado, clave inválida). */
  readonly terminal: boolean;
  /** Segundos que el botón «Reintentar» queda bloqueado. */
  readonly waitSeconds: number;
};

const GENERIC: Failure = {
  text: "Algo salió mal. Inténtalo de nuevo.",
  terminal: false,
  waitSeconds: 0,
};

const DEFAULT_WAIT_SECONDS = 60;

export function describeFailure(error: unknown): Failure {
  if (!(error instanceof WidgetApiError)) {
    return GENERIC;
  }
  if (error.status === 0) {
    return { ...GENERIC, text: "No hay conexión con el servidor. Revisa tu internet y reintenta." };
  }
  if (error.status === 403) {
    return { text: "Este sitio no está autorizado para el chat.", terminal: true, waitSeconds: 0 };
  }
  if (error.status === 401) {
    return { text: "El chat no está disponible en este momento.", terminal: true, waitSeconds: 0 };
  }
  if (error.status === 429) {
    const waitSeconds = error.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS;
    return {
      text: `Hay muchas solicitudes. Espera ${waitSeconds} segundos y vuelve a intentarlo.`,
      terminal: false,
      waitSeconds,
    };
  }
  return GENERIC;
}
