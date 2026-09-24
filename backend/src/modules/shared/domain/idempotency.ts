import type { TenantId } from "./tenant-id";

/** Respuesta ya servida para una `Idempotency-Key`, por tenant. */
export type IdempotencyRecord = {
  readonly tenantId: TenantId;
  readonly key: string;
  readonly actorSubject: string;
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly createdAt: Date;
};

/** Clave de la superficie de plataforma: sin tenant (el alta lo crea) y con actor fijo. */
export type PlatformIdempotencyRecord = Omit<IdempotencyRecord, "tenantId" | "actorSubject">;

/** Otra peticion ya reservo la clave (p. ej. dos envios concurrentes). */
export class IdempotencyKeyTakenError extends Error {
  constructor() {
    super("La Idempotency-Key ya fue usada");
    this.name = "IdempotencyKeyTakenError";
  }
}
