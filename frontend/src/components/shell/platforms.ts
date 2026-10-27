/** Destinos de la consola: una sola lista para la cabecera, los atajos y la portada. */
export type Platform = {
  readonly href: string;
  readonly label: string;
  readonly key: string;
  readonly detail: string;
  readonly roles: string;
};

function platform(
  href: string,
  label: string,
  key: string,
  detail: string,
  roles: string,
): Platform {
  return { href, label, key, detail, roles };
}

export const PLATFORMS: readonly Platform[] = [
  platform(
    "/panel",
    "Panel",
    "1",
    "Agenda, cupos libres y expediente por documento.",
    "operator · admin",
  ),
  platform(
    "/panel/conocimiento",
    "Conocimiento",
    "2",
    "Lo que el bot responde en las consultas generales.",
    "operator · admin",
  ),
  platform(
    "/panel/bot",
    "Bot",
    "3",
    "Clave del widget, sitios permitidos, parámetros y textos.",
    "operator · admin",
  ),
  platform("/panel/ajustes", "Ajustes", "4", "Tope del rango de consulta.", "admin"),
  platform(
    "/chat",
    "Chat",
    "5",
    "Consola de pruebas del widget, con sesión propia.",
    "clave del widget",
  ),
  platform(
    "/simulador",
    "Simulador",
    "6",
    "Maestros y cupos de prueba. Se apaga en producción.",
    "admin",
  ),
  platform(
    "/simulador/bandeja",
    "Bandeja",
    "7",
    "Aprobar o rechazar las solicitudes que originó el chat.",
    "admin",
  ),
];

/** Tecla que abre o cierra la franja de sesión. */
export const SESSION_SHORTCUT = "0";
