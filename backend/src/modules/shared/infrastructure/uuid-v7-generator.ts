import { v7 } from "uuid";
import type { IdGenerator } from "../domain/ports/id-generator";

/** Adaptador: UUIDv7, ordenables en el tiempo (sirven de desempate en el cursor). */
export const uuidV7Generator: IdGenerator = {
  next: () => v7(),
};
