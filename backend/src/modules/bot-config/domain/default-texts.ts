/**
 * Textos predeterminados del bot. El tenant solo guarda los que sobrescribe. Todo texto del
 * chat sale de aqui, de la base de conocimiento o de datos de dominio (sin IA).
 * `{clinic_name}` vale en todas las claves; el resto, solo donde lo dice TEXT_PLACEHOLDERS.
 */
export const DEFAULT_TEXTS = {
  welcome: "Hola, soy el asistente virtual de {clinic_name}. ¿En qué te puedo ayudar?",
  kb_see_more_label: "Ver más",
  menu_prompt: "Elige una opción.",
  option_appointments: "Mis citas",
  option_kb: "Consultas generales",
  option_advisor: "Hablar con un asesor",
  option_menu: "Menú principal",
  option_cancel: "Cancelar",
  option_confirm: "Confirmar",
  option_accept: "Acepto",
  option_decline: "No acepto",
  option_skip: "Omitir",
  option_restart: "Corregir mis datos",
  option_more: "Ver más",
  invalid_option: "Elige una de las opciones para continuar.",
  generic_error: "No pudimos completar la operación. Intenta de nuevo.",
  kb_prompt: "Escribe tu pregunta en pocas palabras.",
  kb_no_results:
    "No encontré información sobre eso. Puedes intentar con otras palabras o hablar con un asesor.",
  kb_results_prompt: "¿Algo más?",
  kb_another: "Otra consulta",
  handoff_created: "Listo. Un asesor de {clinic_name} revisará tu caso y te contactará.",
  closed_prompt: "Si necesitas algo más, vuelve al menú.",
  id_document_type_prompt: "Para gestionar tus citas, elige tu tipo de documento.",
  doc_type_cc: "Cédula de ciudadanía",
  doc_type_ti: "Tarjeta de identidad",
  doc_type_ce: "Cédula de extranjería",
  doc_type_pa: "Pasaporte",
  doc_type_rc: "Registro civil",
  id_document_number_prompt: "Escribe tu número de documento, sin puntos ni espacios.",
  id_document_number_invalid: "Ese número no es válido. Usa solo letras y números (3 a 20).",
  verify_intro: "Para proteger tus datos, responde dos preguntas de seguridad.",
  verify_q_birth_day: "¿Qué día del mes naciste? Escribe solo el número.",
  verify_q_birth_month: "¿En qué mes naciste?",
  verify_q_birth_year: "¿En qué año naciste? Escribe los cuatro dígitos.",
  verify_q_phone_last_4: "Escribe los últimos 4 dígitos de tu celular registrado.",
  verify_q_phone_first_3: "Escribe los primeros 3 dígitos de tu celular registrado.",
  verify_q_email_hint: "¿Cuál de estos se parece a tu correo registrado?",
  verify_success: "Verificamos tu identidad.",
  verify_failed: "No pudimos verificar tus datos. Intentos restantes: {remaining}.",
  verify_locked:
    "Por seguridad, la verificación de este documento queda bloqueada hasta {until}. Un asesor puede ayudarte.",
  verify_unverifiable:
    "No podemos verificar tu identidad por este medio. Un asesor puede ayudarte.",
  prereg_not_found: "No encontramos ese documento en {clinic_name}. Puedes hacer un pre-registro.",
  privacy_notice:
    "Para crear tu pre-registro, {clinic_name} tratará tus datos personales según su política de tratamiento de datos (Ley 1581 de 2012). ¿Aceptas?",
  privacy_declined: "Entendido. Sin tu autorización no podemos crear el pre-registro.",
  prereg_given_names_prompt: "Escribe tus nombres.",
  prereg_family_names_prompt: "Escribe tus apellidos.",
  prereg_birth_date_prompt: "Escribe tu fecha de nacimiento (AAAA-MM-DD).",
  prereg_phone_prompt: "Escribe tu número de celular (10 dígitos).",
  prereg_email_prompt: "Escribe tu correo electrónico, o elige Omitir.",
  prereg_invalid: "Ese dato no es válido. Intenta de nuevo.",
  prereg_confirm_prompt:
    "Revisa tus datos: {given_names} {family_names}, nacimiento {birth_date}, celular {phone}, correo {email}. ¿Son correctos?",
  prereg_done: "Creamos tu pre-registro. {clinic_name} lo confirmará.",
  prereg_document_taken: "Ese documento ya está registrado. Vamos a verificar tu identidad.",
  appointments_menu_prompt: "¿Qué quieres hacer con tus citas?",
  option_book: "Agendar una cita",
  option_reschedule: "Reprogramar una cita",
  option_cancel_appointment: "Cancelar una cita",
  book_service_prompt: "¿Para qué servicio?",
  book_no_services: "No hay servicios disponibles en este momento.",
  book_practitioner_prompt: "¿Con qué profesional?",
  option_any_practitioner: "Cualquiera",
  book_day_prompt: "Elige un día.",
  book_no_days: "No hay cupos disponibles en los próximos días.",
  book_slot_prompt: "Elige una hora.",
  book_confirm_prompt: "Vas a solicitar {service} el {when} con {practitioner}. ¿Confirmas?",
  request_created:
    "Enviamos tu solicitud. {clinic_name} la confirmará; te guardamos el cupo hasta {hold_until}.",
  slot_taken: "Ese horario se acaba de ocupar. Elige otro.",
  pending_limit: "Ya tienes {max} solicitudes pendientes. Espera a que {clinic_name} las resuelva.",
  change_pending: "Esa cita ya tiene un cambio pendiente.",
  appointment_unavailable: "Esa cita ya no se puede modificar.",
  no_upcoming_appointments: "No tienes citas próximas.",
  pick_appointment_prompt: "¿Cuál cita?",
  cancel_confirm_prompt: "¿Confirmas que quieres cancelar la cita del {when}?",
  cancel_request_created: "Enviamos tu solicitud de cancelación. {clinic_name} la confirmará.",
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;

const EXTRA_PLACEHOLDERS: Partial<Record<TextKey, readonly string[]>> = {
  verify_failed: ["remaining"],
  verify_locked: ["until"],
  prereg_confirm_prompt: ["given_names", "family_names", "birth_date", "phone", "email"],
  book_confirm_prompt: ["service", "when", "practitioner"],
  request_created: ["hold_until"],
  pending_limit: ["max"],
  cancel_confirm_prompt: ["when"],
};

/** Marcadores admitidos por clave, ademas de `{clinic_name}`. */
export const TEXT_PLACEHOLDERS = Object.fromEntries(
  (Object.keys(DEFAULT_TEXTS) as TextKey[]).map((key) => [key, EXTRA_PLACEHOLDERS[key] ?? []]),
) as Record<TextKey, readonly string[]>;
