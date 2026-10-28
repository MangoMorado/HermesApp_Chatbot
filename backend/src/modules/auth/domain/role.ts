/** Roles del producto. No hay jerarquia implicita: cada ruta declara a quien admite. */
export const ROLES = ["widget", "operator", "admin", "service", "platform"] as const;

export type Role = (typeof ROLES)[number];

/** Roles que viven dentro de un tenant; `platform` no lleva tenant. */
export type TenantRole = Exclude<Role, "platform">;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
