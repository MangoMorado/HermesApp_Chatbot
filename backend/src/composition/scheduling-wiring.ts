import type { PrismaClient } from "@prisma/client";
import type { ExpireDueRequests } from "../modules/scheduling/application/appointment-request-queries";
import { createListAppointments } from "../modules/scheduling/application/list-appointments";
import { createListAvailability } from "../modules/scheduling/application/list-availability";
import { createListHealthcareServices } from "../modules/scheduling/application/list-healthcare-services";
import { createListPractitioners } from "../modules/scheduling/application/list-practitioners";
import { createListScheduleSlots } from "../modules/scheduling/application/list-schedule-slots";
import { createListSchedules } from "../modules/scheduling/application/list-schedules";
import { createPrismaAppointmentRepository } from "../modules/scheduling/infrastructure/prisma-appointment-repository";
import { createPrismaHealthcareServiceRepository } from "../modules/scheduling/infrastructure/prisma-healthcare-service-repository";
import { createPrismaPractitionerRepository } from "../modules/scheduling/infrastructure/prisma-practitioner-repository";
import { createPrismaScheduleRepository } from "../modules/scheduling/infrastructure/prisma-schedule-repository";
import { createPrismaSlotRepository } from "../modules/scheduling/infrastructure/prisma-slot-repository";
import { createGetTenantSettings } from "../modules/tenancy/application/tenant-settings";
import { createPrismaTenantSettingsRepository } from "../modules/tenancy/infrastructure/prisma-tenant-settings-repository";

/** Lecturas de agenda para el contenedor. Aparte para no pasar de 400 lineas en el root. */

export function schedulingReads(prisma: PrismaClient, expire: ExpireDueRequests) {
  const tenantSettings = createPrismaTenantSettingsRepository(prisma);
  const practitioners = createPrismaPractitionerRepository(prisma);
  const services = createPrismaHealthcareServiceRepository(prisma);
  const schedules = createPrismaScheduleRepository(prisma);
  const slots = createPrismaSlotRepository(prisma);
  const appointments = createPrismaAppointmentRepository(prisma);
  return {
    listPractitioners: createListPractitioners(practitioners),
    listHealthcareServices: createListHealthcareServices(services),
    listSchedules: createListSchedules(schedules),
    listAvailability: createListAvailability(slots, tenantSettings, expire),
    listScheduleSlots: createListScheduleSlots(schedules, slots, tenantSettings, expire),
    listAppointments: createListAppointments(schedules, appointments, tenantSettings),
    getTenantSettings: createGetTenantSettings(tenantSettings),
  };
}
