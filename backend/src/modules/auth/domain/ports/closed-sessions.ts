/** Sesiones del proveedor cerradas por back-channel logout. */
export type ClosedSessions = {
  /** Nunca acorta un cierre existente. */
  close(providerSessionId: string, until: Date): Promise<void>;
  isClosed(providerSessionId: string, now: Date): Promise<boolean>;
};
