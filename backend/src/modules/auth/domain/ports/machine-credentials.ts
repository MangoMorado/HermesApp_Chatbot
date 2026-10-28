import type { TenantId } from "@/modules/shared/domain/tenant-id";

export type MachineCredentialRef = {
  readonly kind: "widget" | "service";
  readonly tenantId: string;
};

export type MachineCredential = { clientId: string; clientSecret: string };

/** Resuelve las credenciales de un cliente maquina; `null` si no existen. */
export type MachineCredentialResolver = (
  ref: MachineCredentialRef,
) => Promise<MachineCredential | null>;

/** Credenciales de widget por tenant, con el secreto sellado en reposo. */
export type MachineCredentialStore = {
  put(tenantId: TenantId, kind: "widget", credential: MachineCredential, now: Date): Promise<void>;
  get(tenantId: TenantId, kind: "widget"): Promise<MachineCredential | null>;
};
