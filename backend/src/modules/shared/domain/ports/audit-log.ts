import type { AuditEvent } from "../audit-event";

export type AuditLog = {
  record(event: AuditEvent): Promise<void>;
};
