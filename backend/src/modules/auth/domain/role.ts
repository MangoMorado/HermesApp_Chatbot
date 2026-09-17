/** Roles del producto. No hay jerarquia implicita: cada ruta declara a quien admite. */
export const ROLES = ["widget", "operator", "admin", "service"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
