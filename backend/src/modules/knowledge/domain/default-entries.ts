import type { KnowledgeEntryDraft } from "./knowledge-entry";

/** Entradas que recibe un tenant recien dado de alta; la clinica las edita. */
export const DEFAULT_KNOWLEDGE_ENTRIES: readonly KnowledgeEntryDraft[] = [
  {
    category: "Información general",
    question: "¿Cuál es el horario de atención?",
    answer: "Edita esta respuesta con el horario de atención de tu clínica.",
    detail: null,
    keywords: ["horario", "hora", "atencion", "abierto"],
    position: 0,
    active: true,
  },
  {
    category: "Información general",
    question: "¿Dónde están ubicados?",
    answer: "Edita esta respuesta con la dirección de tu clínica.",
    detail: null,
    keywords: ["ubicacion", "direccion", "sede", "llegar"],
    position: 1,
    active: true,
  },
  {
    category: "Citas",
    question: "¿Cómo agendo una cita?",
    answer:
      "Puedes solicitar una cita desde este chat. Te pediremos tu documento para identificarte.",
    detail: null,
    keywords: ["agendar", "cita", "citas", "reservar", "turno"],
    position: 0,
    active: true,
  },
];
