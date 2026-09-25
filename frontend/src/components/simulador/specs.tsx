import { Id } from "@/components/ui/cells";
import { Flap } from "@/components/ui/flap";
import { text } from "@/lib/format";
import {
  createSimHealthcareService,
  createSimPatient,
  createSimPractitioner,
  createSimSchedule,
  deleteSimHealthcareService,
  deleteSimPatient,
  deleteSimPractitioner,
  deleteSimSchedule,
  listSimHealthcareService,
  listSimPatient,
  listSimPractitioner,
  listSimSchedule,
  updateSimHealthcareService,
  updateSimPatient,
  updateSimPractitioner,
  updateSimSchedule,
} from "@/sim/default/default";
import type { CrudSpec } from "./sim-crud";

const IDENTIFIER = { name: "identifier_value", label: "Identificador Hermes" };

export const PRACTITIONERS: CrudSpec = {
  scope: "practitioner",
  noun: "profesional",
  createFields: [{ name: "name", label: "Nombre" }, IDENTIFIER],
  update: {
    label: "Renombrar",
    fields: [{ name: "name", label: "Nuevo nombre" }],
    body: (v) => ({ name: v.name }),
  },
  columns: [
    { header: "Id", render: (row) => <Id value={row.id} /> },
    { header: "Nombre", render: (row) => text(row, "name") },
    {
      header: "Identificador",
      render: (row) => <span className="data">{text(row, "identifier_value")}</span>,
    },
  ],
  list: () => listSimPractitioner(),
  create: (init) => createSimPractitioner(init),
  patch: (id, init) => updateSimPractitioner(id, init),
  remove: (id, init) => deleteSimPractitioner(id, init),
};

export const SERVICES: CrudSpec = {
  ...PRACTITIONERS,
  scope: "service",
  noun: "servicio",
  list: () => listSimHealthcareService(),
  create: (init) => createSimHealthcareService(init),
  patch: (id, init) => updateSimHealthcareService(id, init),
  remove: (id, init) => deleteSimHealthcareService(id, init),
};

export const SCHEDULES: CrudSpec = {
  scope: "schedule",
  noun: "agenda",
  createFields: [
    IDENTIFIER,
    { name: "practitioner_id", label: "Profesional (id)" },
    { name: "healthcare_service_id", label: "Servicio (id)" },
  ],
  update: { label: "Desactivar", fields: [], body: () => ({ active: false }) },
  columns: [
    { header: "Agenda", render: (row) => <Id value={row.id} /> },
    { header: "Profesional", render: (row) => <Id value={row.practitioner_id} /> },
    { header: "Servicio", render: (row) => <Id value={row.healthcare_service_id} /> },
    { header: "Estado", render: (row, i) => <Flap status={text(row, "active")} row={i} /> },
  ],
  list: () => listSimSchedule(),
  create: (init) => createSimSchedule(init),
  patch: (id, init) => updateSimSchedule(id, init),
  remove: (id, init) => deleteSimSchedule(id, init),
};

export const PATIENTS: CrudSpec = {
  scope: "patient",
  noun: "paciente",
  createFields: [
    IDENTIFIER,
    { name: "document_type", label: "Tipo de documento", options: ["CC", "TI", "CE", "PA", "RC"] },
    { name: "document_number", label: "Número de documento" },
    { name: "given_names", label: "Nombres" },
    { name: "family_names", label: "Apellidos" },
    { name: "birth_date", label: "Nacimiento", type: "date" },
  ],
  update: {
    label: "Cambiar nombres",
    fields: [{ name: "given_names", label: "Nuevos nombres" }],
    body: (v) => ({ given_names: v.given_names }),
  },
  columns: [
    { header: "Id", render: (row) => <Id value={row.id} /> },
    {
      header: "Documento",
      render: (row) => (
        <span className="data">{`${text(row, "document_type")} ${text(row, "document_number")}`}</span>
      ),
    },
    {
      header: "Nombre",
      render: (row) => `${text(row, "given_names")} ${text(row, "family_names")}`,
    },
  ],
  list: () => listSimPatient(),
  create: (init) => createSimPatient(init),
  patch: (id, init) => updateSimPatient(id, init),
  remove: (id, init) => deleteSimPatient(id, init),
};
