import type { ContractWorld } from "./world";

export type Surface = "chatbot" | "platform" | "sim";
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** Un caso de `contrato-rutas`: una operacion declarada, el status esperado y como provocarlo. */
export type ContractCase = {
  readonly surface: Surface;
  readonly method: HttpMethod;
  /** Clave exacta de `document.paths`, p. ej. `/knowledge-entries/{id}`. */
  readonly path: string;
  readonly status: number;
  readonly name: string;
  readonly run: (world: ContractWorld) => Promise<Response>;
};

/** Status 4xx que se exigen cubrir (o eximir con motivo) cuando la operacion los declara. */
export const CHECKED_STATUSES = [400, 401, 403, 404, 409, 422, 429] as const;
