import type { Fragment, PostmanItem } from "../items";
import { botSaid, chatHistory, chatStep, type Letter } from "./chat";
import { expectFhirStatus, expectStatus, PREFIX, step } from "./request";
import { seedPatient, verificationAnswers } from "./seed-patients";

/**
 * Widget de punta a punta para una clinica (spec 5.3 §4.4). Los tres caminos devuelven el cupo a
 * `free`: rechazo por FHIR; aprobacion y cancelacion pedida desde el chat (Task completado); y
 * pre-registro con una solicitud que rechaza la bandeja del simulador.
 */
export const widgetFolder = (letter: Letter) => `widget E2E — clinica ${letter.toUpperCase()}`;

const service = (letter: Letter) =>
  ({ client: letter === "a" ? "service_a" : "service_b" }) as const;
const admin = (letter: Letter) => ({ user: letter === "a" ? "admin_a" : "admin_b" }) as const;

function openSession(letter: Letter, name: string): PostmanItem {
  return step({
    folder: widgetFolder(letter),
    name,
    method: "POST",
    path: "/api/v1/widget/sessions",
    auth: "none",
    headers: { Origin: `{{widget_origin_${letter}}}` },
    body: `{ "widget_key": "{{widget_key_${letter}}}" }`,
    test: [
      ...expectStatus(201),
      "var json = pm.response.json();",
      `pm.collectionVariables.set("widget_token_${letter}", json.access_token);`,
      `pm.collectionVariables.set("conversation_secret_${letter}", json.conversation_secret);`,
    ],
  });
}

/** Agenda el primer cupo libre: guarda dia y hora para reconocer la cita despues. */
function bookFirstSlot(letter: Letter, label: string): PostmanItem[] {
  const folder = widgetFolder(letter);
  const turn = (name: string, action: Parameters<typeof chatStep>[3], test: string[] = []) =>
    chatStep(folder, letter, `${label}: ${name}`, action, test);
  return [
    turn("agendar", { option: "option_book" }),
    turn("servicio", { first: true }),
    turn("profesional", { option: "option_any_practitioner" }),
    turn("dia", { first: true, saveAs: "day_label" }),
    turn("hora", { first: true, saveAs: "slot_label" }),
    turn("confirmar", { option: "option_confirm" }, botSaid("request_created")),
  ];
}

function proposed(letter: Letter, name: string): PostmanItem {
  return step({
    folder: widgetFolder(letter),
    name,
    method: "GET",
    path: `/fhir/Appointment?patient=Patient/{{patient_id_${letter}}}&status=proposed`,
    auth: service(letter),
    test: [
      ...expectFhirStatus(200),
      "var entries = pm.response.json().entry || [];",
      'pm.test("una solicitud propuesta", function () { pm.expect(entries.length).to.equal(1); });',
      `if (entries[0]) { pm.collectionVariables.set("appointment_id_${letter}", entries[0].resource.id); }`,
    ],
  });
}

function resolveAppointment(letter: Letter, name: string, body: unknown): PostmanItem {
  return step({
    folder: widgetFolder(letter),
    name,
    method: "PUT",
    path: `/fhir/Appointment/{{appointment_id_${letter}}}`,
    auth: service(letter),
    body,
    test: expectFhirStatus(200),
  });
}

function identifyExisting(letter: Letter): PostmanItem[] {
  const folder = widgetFolder(letter);
  const answers = verificationAnswers(letter);
  return [
    chatHistory(folder, letter),
    chatStep(folder, letter, "verificar: mis citas", { option: "option_appointments" }),
    chatStep(folder, letter, "verificar: tipo de documento", { option: "doc_type_cc" }),
    chatStep(folder, letter, "verificar: documento", { text: seedPatient(letter).documentNumber }),
    chatStep(folder, letter, "verificar: primera pregunta", { answer: answers }),
    chatStep(folder, letter, "verificar: segunda pregunta", { answer: answers }, [
      ...botSaid("verify_success"),
    ]),
  ];
}

function rejection(letter: Letter): PostmanItem[] {
  return [
    ...bookFirstSlot(letter, "rechazo"),
    proposed(letter, "rechazo: Hermes localiza la solicitud"),
    resolveAppointment(letter, "rechazo: Hermes la rechaza", {
      resourceType: "Appointment",
      status: "cancelled",
    }),
  ];
}

function approvalAndCancellation(letter: Letter): PostmanItem[] {
  const folder = widgetFolder(letter);
  return [
    ...bookFirstSlot(letter, "aprobacion"),
    proposed(letter, "aprobacion: Hermes localiza la solicitud"),
    resolveAppointment(letter, "aprobacion: Hermes la aprueba", {
      resourceType: "Appointment",
      status: "booked",
      identifier: [{ system: "urn:hermes:appointment", value: `${PREFIX}AP-{{$guid}}` }],
    }),
    chatStep(folder, letter, "cancelacion: cancelar una cita", {
      option: "option_cancel_appointment",
    }),
    chatStep(folder, letter, "cancelacion: la cita aprobada", { cancelApproved: true }),
    chatStep(folder, letter, "cancelacion: confirmar", { option: "option_confirm" }, [
      ...botSaid("cancel_request_created"),
    ]),
    step({
      folder,
      name: "cancelacion: Hermes localiza el Task",
      method: "GET",
      path: `/fhir/Task?patient=Patient/{{patient_id_${letter}}}&status=requested`,
      auth: service(letter),
      test: [
        ...expectFhirStatus(200),
        "var entries = pm.response.json().entry || [];",
        'pm.test("un Task de cancelacion", function () { pm.expect(entries.length).to.equal(1); });',
        `if (entries[0]) { pm.collectionVariables.set("task_id_${letter}", entries[0].resource.id); }`,
      ],
    }),
    step({
      folder,
      name: "cancelacion: Hermes completa el Task",
      method: "PUT",
      path: `/fhir/Task/{{task_id_${letter}}}`,
      auth: service(letter),
      body: { resourceType: "Task", status: "completed" },
      test: expectFhirStatus(200),
    }),
  ];
}

function preRegistration(letter: Letter): PostmanItem[] {
  const folder = widgetFolder(letter);
  const turn = (name: string, action: Parameters<typeof chatStep>[3], test: string[] = []) =>
    chatStep(folder, letter, `pre-registro: ${name}`, action, test);
  return [
    openSession(letter, "pre-registro: nueva sesion"),
    chatHistory(folder, letter),
    turn("mis citas", { option: "option_appointments" }),
    turn("tipo de documento", { option: "doc_type_cc" }),
    turn("documento nuevo", { randomDocument: true }),
    turn("acepto el aviso", { option: "option_accept" }),
    turn("nombres", { text: "Newman" }),
    turn("apellidos", { text: "Prueba" }),
    turn("nacimiento", { text: "1990-03-07" }),
    turn("celular", { text: "3001234567" }),
    turn("sin correo", { option: "option_skip" }),
    turn("confirmar datos", { option: "option_confirm" }),
    ...bookFirstSlot(letter, "pre-registro"),
    ...inboxReject(letter),
  ];
}

function inboxReject(letter: Letter): PostmanItem[] {
  const folder = widgetFolder(letter);
  return [
    step({
      folder,
      name: "pre-registro: la bandeja del simulador la muestra",
      method: "GET",
      path: "/api/sim/v1/inbox?limit=200",
      auth: admin(letter),
      test: [
        ...expectStatus(200),
        `var doc = pm.collectionVariables.get("prereg_doc_${letter}");`,
        "var found = pm.response.json().data.filter(function (r) {",
        "  return r.patient && r.patient.document_number === doc;",
        "});",
        'pm.test("la solicitud del pre-registro esta en la bandeja", function () {',
        "  pm.expect(found.length).to.equal(1);",
        "});",
        `if (found[0]) { pm.collectionVariables.set("inbox_request_${letter}", found[0].id); }`,
      ],
    }),
    step({
      folder,
      name: "pre-registro: la bandeja la rechaza",
      method: "POST",
      path: `/api/sim/v1/inbox/{{inbox_request_${letter}}}/reject`,
      auth: admin(letter),
      test: expectStatus(200),
    }),
  ];
}

export function widgetFragment(letter: Letter): Fragment {
  return {
    name: widgetFolder(letter),
    item: [
      openSession(letter, "abrir sesion"),
      ...identifyExisting(letter),
      ...rejection(letter),
      ...approvalAndCancellation(letter),
      ...preRegistration(letter),
    ],
  };
}
