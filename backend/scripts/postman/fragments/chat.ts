import type { PostmanItem } from "../items";
import { CLEANUP_ENTRY, step } from "./request";

/**
 * Pasos de la conversacion del widget. Cada paso elige su mensaje en el pre-request a partir
 * de la ultima respuesta del bot (opciones y mensajes guardados por letra de clinica), y los
 * rotulos salen de los textos del bot de la clinica (`bot_texts_<x>`, leidos en `setup`).
 */
export type Letter = "a" | "b";

/** Respuesta conocida de cada pregunta de verificacion del paciente sembrado que se usa. */
export type Answers = Record<string, { kind: "text" | "option"; value: string }>;

const PRELUDE = `var X = "__X__";
var options = JSON.parse(pm.collectionVariables.get("chat_options_" + X) || "[]");
var messages = JSON.parse(pm.collectionVariables.get("chat_messages_" + X) || "[]");
var texts = JSON.parse(pm.collectionVariables.get("bot_texts_" + X) || "{}");
function labels() { return options.map(function (o) { return o.label; }).join(" | "); }
function byLabel(label) {
  for (var i = 0; i < options.length; i++) {
    if (options[i].label === label) { return { option_id: options[i].id }; }
  }
  throw new Error("Sin opcion «" + label + "»: " + labels());
}
function byText(key) { return byLabel(texts[key]); }
function first(saveAs) {
  if (!options[0]) { throw new Error("El bot no ofrece opciones: " + messages.join(" / ")); }
  if (saveAs) { pm.collectionVariables.set(saveAs + "_" + X, options[0].label); }
  return { option_id: options[0].id };
}
function send(body) { pm.variables.set("chat_body", JSON.stringify(body)); }`;

const STORE = `var X = "__X__";
pm.test("chat 200", function () { pm.expect(pm.response.code).to.equal(200); });
if (pm.response.code !== 200) {
  console.log("Chat: " + pm.response.text());
  pm.execution.setNextRequest(${JSON.stringify(CLEANUP_ENTRY)});
} else {
  var json = pm.response.json();
  var texts = (json.messages || []).map(function (m) { return typeof m === "string" ? m : m.text; });
  pm.collectionVariables.set("chat_options_" + X, JSON.stringify(json.options || []));
  pm.collectionVariables.set("chat_messages_" + X, JSON.stringify(texts));
}`;

const QUESTION_KEYS: Record<string, string> = {
  birth_day: "verify_q_birth_day",
  birth_month: "verify_q_birth_month",
  birth_year: "verify_q_birth_year",
  phone_last_4: "verify_q_phone_last_4",
  phone_first_3: "verify_q_phone_first_3",
};

const ANSWER = `var answers = __ANSWERS__;
var keys = ${JSON.stringify(QUESTION_KEYS)};
var joined = messages.join("\\n");
var asked = Object.keys(answers).filter(function (q) { return joined.indexOf(texts[keys[q]]) >= 0; });
if (asked.length !== 1) { throw new Error("Pregunta de verificacion no reconocida: " + joined); }
var answer = answers[asked[0]];
send(answer.kind === "option" ? byLabel(answer.value) : { text: answer.value });`;

const CANCEL_PICK = `var day = pm.collectionVariables.get("day_label_" + X);
var slot = pm.collectionVariables.get("slot_label_" + X).split(" · ");
var prefix = day + ", " + slot[0];
var practitioner = " · " + slot[1];
var match = options.filter(function (o) {
  return o.label.indexOf(prefix) === 0 && o.label.slice(-practitioner.length) === practitioner;
});
if (match.length !== 1) { throw new Error("Cita aprobada no encontrada (" + prefix + "): " + labels()); }
send({ option_id: match[0].id });`;

/** Documento nuevo por ejecucion: el pre-registro queda de rastro, nunca choca con otro. */
const RANDOM_DOCUMENT = `var doc = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
pm.collectionVariables.set("prereg_doc_" + X, doc);
send({ text: doc });`;

/** Que manda un paso: un rotulo de los textos del bot, el primero, un texto o algo propio. */
export type ChatAction =
  | { option: string }
  | { first: true; saveAs?: "day_label" | "slot_label" }
  | { text: string }
  | { answer: Answers }
  | { cancelApproved: true }
  | { randomDocument: true };

function actionScript(action: ChatAction): string {
  if ("option" in action) {
    return `send(byText(${JSON.stringify(action.option)}));`;
  }
  if ("first" in action) {
    return `send(first(${JSON.stringify(action.saveAs ?? "")}));`;
  }
  if ("text" in action) {
    return `send({ text: ${JSON.stringify(action.text)} });`;
  }
  if ("answer" in action) {
    return ANSWER.replace("__ANSWERS__", JSON.stringify(action.answer));
  }
  if ("randomDocument" in action) {
    return RANDOM_DOCUMENT;
  }
  return CANCEL_PICK;
}

const lines = (script: string, letter: Letter) => script.replaceAll("__X__", letter).split("\n");

/** Un turno del paciente: POST /widget/conversation/messages con el mensaje elegido. */
export function chatStep(
  folder: string,
  letter: Letter,
  name: string,
  action: ChatAction,
  test: readonly string[] = [],
): PostmanItem {
  return step({
    folder,
    name,
    method: "POST",
    path: "/api/v1/widget/conversation/messages",
    auth: letter === "a" ? "widget" : "widget_b",
    headers: { "X-Conversation-Secret": `{{conversation_secret_${letter}}}` },
    body: "{{chat_body}}",
    prerequest: [...lines(PRELUDE, letter), ...lines(actionScript(action), letter)],
    test: [...lines(STORE, letter), ...test],
  });
}

/** Lee el historial inicial (saludo y opciones) y lo deja como ultima respuesta. */
export function chatHistory(folder: string, letter: Letter): PostmanItem {
  return step({
    folder,
    name: `conversacion ${letter.toUpperCase()}: historial inicial`,
    method: "GET",
    path: "/api/v1/widget/conversation",
    auth: letter === "a" ? "widget" : "widget_b",
    headers: { "X-Conversation-Secret": `{{conversation_secret_${letter}}}` },
    test: lines(STORE, letter),
  });
}

/** Comprueba que el ultimo turno del bot empieza por el texto del bot dado (sin variables). */
export function botSaid(key: string): string[] {
  return [
    `pm.test("el bot responde ${key}", function () {`,
    '  var texts = JSON.parse(pm.collectionVariables.get("bot_texts_" + X) || "{}");',
    `  var expected = (texts[${JSON.stringify(key)}] || "").split("{")[0];`,
    '  var said = (pm.response.json().messages || []).join("\\n");',
    "  pm.expect(said).to.include(expected);",
    "});",
  ];
}
