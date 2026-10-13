/** Destinos de la consola: una sola lista para la cabecera, los atajos y la portada. */
export const PLATFORMS = [
  {
    href: "/panel",
    label: "Panel",
    key: "1",
    detail: "Agenda, cupos libres y expediente por documento.",
    roles: "operator · admin",
  },
  {
    href: "/panel/conocimiento",
    label: "Conocimiento",
    key: "2",
    detail: "Lo que el bot responde en las consultas generales.",
    roles: "operator · admin",
  },
  {
    href: "/panel/bot",
    label: "Bot",
    key: "3",
    detail: "Clave del widget, sitios permitidos, parámetros y textos.",
    roles: "operator · admin",
  },
  {
    href: "/panel/ajustes",
    label: "Ajustes",
    key: "4",
    detail: "Tope del rango de consulta.",
    roles: "admin",
  },
  {
    href: "/chat",
    label: "Chat",
    key: "5",
    detail: "Consola de pruebas del widget, con sesión propia.",
    roles: "clave del widget",
  },
  {
    href: "/simulador",
    label: "Simulador",
    key: "6",
    detail: "Maestros y cupos de prueba. Se apaga en producción.",
    roles: "admin",
  },
  {
    href: "/simulador/bandeja",
    label: "Bandeja",
    key: "7",
    detail: "Aprobar o rechazar las solicitudes que originó el chat.",
    roles: "admin",
  },
] as const;

/** Tecla que abre o cierra la franja de sesión. */
export const SESSION_SHORTCUT = "0";
