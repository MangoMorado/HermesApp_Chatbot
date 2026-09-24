import { v5 as uuidv5 } from "uuid";
import { addDays, isWeekend, zonedInstant } from "./time";

/**
 * Unica fuente de datos del seed. La consumen dos escritores (chatbot y simulador),
 * asi que la simetria entre ambos lados sale de la construccion. Mismo ancla, mismo
 * resultado: IDs derivados por UUIDv5 y fechas relativas al ancla.
 */

export const IDENTIFIER_SYSTEMS = {
  practitioner: "urn:hermes:practitioner",
  healthcareService: "urn:hermes:healthcare-service",
  schedule: "urn:hermes:schedule",
  slot: "urn:hermes:slot",
  patient: "urn:hermes:patient",
  appointment: "urn:hermes:appointment",
} as const;

const SEED_NAMESPACE = "6f1c2a4e-0b7d-4c55-9a53-3f2e8d1b7c90";
const SLOT_TIMES = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
const SLOT_MINUTES = 30;
const PAST_DAYS = 7;
const FUTURE_DAYS = 14;

export type SeedPractitioner = { id: string; identifierValue: string; name: string };
export type SeedService = { id: string; identifierValue: string; name: string };
export type SeedSchedule = {
  id: string;
  identifierValue: string;
  practitionerId: string;
  healthcareServiceId: string;
};
export type SeedSlot = {
  id: string;
  identifierValue: string;
  scheduleId: string;
  startAt: Date;
  endAt: Date;
  status: "free" | "busy";
};
export type SeedPatient = {
  id: string;
  identifierValue: string;
  documentType: "CC";
  documentNumber: string;
  givenNames: string;
  familyNames: string;
  birthDate: string;
  phone: string;
  email: string;
  status: "active" | "pre_registered";
};
export type SeedAppointment = {
  id: string;
  identifierValue: string;
  patientId: string;
  scheduleId: string;
  slotId: string;
  startAt: Date;
  endAt: Date;
  status: "fulfilled" | "booked";
};
export type SeedTenant = {
  id: string;
  slug: string;
  name: string;
  practitioners: SeedPractitioner[];
  services: SeedService[];
  schedules: SeedSchedule[];
  slots: SeedSlot[];
  patients: SeedPatient[];
  appointments: SeedAppointment[];
};

type TenantTemplate = {
  slug: string;
  name: string;
  practitioners: string[];
  patients: [string, string][];
};

const TEMPLATES: TenantTemplate[] = [
  {
    slug: "clinica-norte",
    name: "Clínica Norte",
    practitioners: ["Ana Gómez", "Luis Pérez", "Marta Ruiz"],
    patients: [
      ["Carlos", "Mejía Soto"],
      ["Diana", "López Rey"],
      ["Jorge", "Castro Gil"],
      ["Laura", "Vargas Paz"],
      ["Pedro", "Rojas Luna"],
    ],
  },
  {
    slug: "clinica-sur",
    name: "Clínica Sur",
    practitioners: ["Sofía Díaz", "Andrés Mora", "Elena Ríos"],
    patients: [
      ["Camila", "Ortiz Vega"],
      ["Mateo", "Suárez Pino"],
      ["Valentina", "Cruz Mar"],
      ["Santiago", "Reyes Sol"],
      ["Isabel", "Navas Río"],
    ],
  },
];

const SERVICES = ["Medicina general", "Odontología"];

/** IDs deterministas: mismo nombre logico -> mismo UUID, sin depender de un contador externo. */
export const seedId = (name: string): string => uuidv5(name, SEED_NAMESPACE);
const pad = (value: number): string => String(value).padStart(3, "0");

function weekdaysBetween(anchor: string, from: number, to: number): string[] {
  const days: string[] = [];
  for (let offset = from; offset <= to; offset++) {
    const date = addDays(anchor, offset);
    if (!isWeekend(date)) {
      days.push(date);
    }
  }
  return days;
}

function buildSlots(
  slug: string,
  schedules: SeedSchedule[],
  anchor: string,
  timeZone: string,
): SeedSlot[] {
  const days = weekdaysBetween(anchor, -PAST_DAYS, FUTURE_DAYS - 1);
  return schedules.flatMap((schedule) =>
    days.flatMap((date) =>
      SLOT_TIMES.map((time) => {
        const identifierValue = `${schedule.identifierValue}-${date}-${time.replace(":", "")}`;
        const startAt = zonedInstant(date, time, timeZone);
        return {
          id: seedId(`${slug}:slot:${identifierValue}`),
          identifierValue,
          scheduleId: schedule.id,
          startAt,
          endAt: new Date(startAt.getTime() + SLOT_MINUTES * 60_000),
          status: "free" as const,
        };
      }),
    ),
  );
}

type AppointmentPlan = {
  patient: SeedPatient;
  schedule: SeedSchedule;
  date: string;
  time: string;
  status: "fulfilled" | "booked";
};

function planAppointments(
  patients: SeedPatient[],
  schedules: SeedSchedule[],
  anchor: string,
): AppointmentPlan[] {
  const past = weekdaysBetween(anchor, -PAST_DAYS, -1);
  const future = weekdaysBetween(anchor, 1, FUTURE_DAYS - 1);
  const active = patients.filter((patient) => patient.status === "active");
  return active.flatMap((patient, index) => {
    const schedule = schedules[index % schedules.length] as SeedSchedule;
    return [
      {
        patient,
        schedule,
        date: past[index % past.length] as string,
        time: "08:00",
        status: "fulfilled" as const,
      },
      {
        patient,
        schedule,
        date: future[index % future.length] as string,
        time: "08:30",
        status: "booked" as const,
      },
    ];
  });
}

function buildAppointments(
  slug: string,
  plans: AppointmentPlan[],
  slots: SeedSlot[],
): SeedAppointment[] {
  const slotsByValue = new Map(slots.map((slot) => [slot.identifierValue, slot]));
  return plans.map((plan, index) => {
    const slotValue = `${plan.schedule.identifierValue}-${plan.date}-${plan.time.replace(":", "")}`;
    const slot = slotsByValue.get(slotValue);
    if (!slot) {
      throw new Error(`Seed inconsistente: no existe el cupo ${slotValue}`);
    }
    slot.status = "busy";
    const identifierValue = `A-${pad(index + 1)}`;
    return {
      id: seedId(`${slug}:appointment:${identifierValue}`),
      identifierValue,
      patientId: plan.patient.id,
      scheduleId: plan.schedule.id,
      slotId: slot.id,
      startAt: slot.startAt,
      endAt: slot.endAt,
      status: plan.status,
    };
  });
}

function buildTenant(
  template: TenantTemplate,
  tenantIndex: number,
  anchor: string,
  timeZone: string,
): SeedTenant {
  const { slug } = template;
  const practitioners = template.practitioners.map((name, i) => ({
    id: seedId(`${slug}:practitioner:P-${pad(i + 1)}`),
    identifierValue: `P-${pad(i + 1)}`,
    name,
  }));
  const services = SERVICES.map((name, i) => ({
    id: seedId(`${slug}:service:S-${pad(i + 1)}`),
    identifierValue: `S-${pad(i + 1)}`,
    name,
  }));
  const schedules = practitioners.map((practitioner, i) => ({
    id: seedId(`${slug}:schedule:SCH-${pad(i + 1)}`),
    identifierValue: `SCH-${pad(i + 1)}`,
    practitionerId: practitioner.id,
    healthcareServiceId: (services[i % services.length] as SeedService).id,
  }));
  const patients = template.patients.map(([givenNames, familyNames], i) => ({
    id: seedId(`${slug}:patient:PAT-${pad(i + 1)}`),
    identifierValue: `PAT-${pad(i + 1)}`,
    documentType: "CC" as const,
    documentNumber: `${tenantIndex + 1}0000000${i + 1}`,
    givenNames,
    familyNames,
    birthDate: `19${80 + i}-0${i + 1}-15`,
    phone: `30000000${tenantIndex + 1}${i + 1}`,
    email: `paciente${i + 1}@${slug}.test`,
    status: i === template.patients.length - 1 ? ("pre_registered" as const) : ("active" as const),
  }));
  const slots = buildSlots(slug, schedules, anchor, timeZone);
  const appointments = buildAppointments(
    slug,
    planAppointments(patients, schedules, anchor),
    slots,
  );
  return {
    id: seedId(`tenant:${slug}`),
    slug,
    name: template.name,
    practitioners,
    services,
    schedules,
    slots,
    patients,
    appointments,
  };
}

export function buildSeed(anchor: string, timeZone: string): SeedTenant[] {
  return TEMPLATES.map((template, index) => buildTenant(template, index, anchor, timeZone));
}
