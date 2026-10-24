import type {
  Appointment,
  AppointmentService,
  CareDietInstruction,
  CareService,
  CareHygieneInstruction,
  CareMedication,
  CarePlan,
  CarePlanGoal,
  CareTask,
  Client,
  ClientHazard,
  ClientLanguage,
  Diagnosis,
  EmergencyContact,
  ServiceRequirement,
  User,
} from "@prisma/client";

export interface CarePlanGraph extends CarePlan {
  goals: CarePlanGoal[];
  tasks: CareTask[];
  medications: CareMedication[];
  diet: CareDietInstruction[];
  hygiene: CareHygieneInstruction[];
}

export interface ClientGraph extends Client {
  languages: ClientLanguage[];
  emergencyContacts: EmergencyContact[];
  diagnoses: Diagnosis[];
  hazards: ClientHazard[];
  serviceRequirements: ServiceRequirement[];
  carePlans: CarePlanGraph[];
}

export interface AppointmentGraph extends Appointment {
  client: ClientGraph;
  caregiver: User;
  services: (AppointmentService & { service: CareService })[];
}

export type CompletionMap = Map<string, boolean>;

export function completionKey(itemType: string, itemId: string): string {
  return `${itemType}:${itemId}`;
}
