import { getContainer } from "@/composition-root";
import { NotFoundError } from "@/modules/shared/domain/not-found-error";

/** Si el simulador esta apagado, toda ruta /api/sim responde 404. */
export function requireSimulatorEnabled(): void {
  if (!getContainer().hermesSimulatorEnabled) {
    throw new NotFoundError();
  }
}
