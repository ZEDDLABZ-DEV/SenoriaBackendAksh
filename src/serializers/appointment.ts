import { formatClock, nullableDate } from "../lib/dates";
import { presentVisit, type VisitRow } from "../domain/visit";
import { serializeCarePlan } from "./carePlan";
import { completionKey, type AppointmentGraph, type CompletionMap } from "./types";

export interface OpenCoverageRequest {
  id: string;
  reason: string;
  requestedById: string;
  createdAt: string;
}

export function serializeAppointment(
  appointment: AppointmentGraph,
  completions: CompletionMap,
  visits: VisitRow[],
  today: string,
  coverageRequest: OpenCoverageRequest | null = null,
) {
  const client = appointment.client;
  const linkedPlan =
    client.carePlans.find((plan) => plan.id === appointment.carePlanId) ?? client.carePlans[0];
  const tasks = linkedPlan
    ? [...linkedPlan.tasks]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((task) => {
          const completed = completions.get(completionKey("task", task.id)) === true;
          return {
            id: task.id,
            title: task.name,
            name: task.name,
            description: task.description,
            isCompleted: completed,
            completed,
          };
        })
    : [];
  const presentation = presentVisit(
    {
      appointmentStatus: appointment.appointmentStatus,
      recordStatus: appointment.recordStatus,
      scheduledDate: nullableDate(appointment.scheduledDate),
      endDate: nullableDate(appointment.endDate),
      cancellationReason: appointment.cancellationReason,
    },
    visits,
    today,
  );

  return {
    id: appointment.id,
    description: appointment.description,
    scheduledDate: nullableDate(appointment.scheduledDate),
    endDate: nullableDate(appointment.endDate),
    startTime: formatClock(appointment.startTime),
    endTime: formatClock(appointment.endTime),
    duration: appointment.durationMinutes,
    appointmentType: appointment.appointmentType,
    appointmentStatus: appointment.appointmentStatus,
    instructions: appointment.instructions,
    notes: appointment.notes,
    checkInTime: presentation.checkInTime,
    checkOutTime: presentation.checkOutTime,
    cancellationReason: presentation.cancellationReason,
    status: appointment.recordStatus,
    locationStreet: appointment.locationStreet,
    locationCity: appointment.locationCity,
    locationState: appointment.locationState,
    locationZipCode: appointment.locationZipCode,
    locationGateCode: appointment.locationGateCode,
    locationNavigation: appointment.locationNavigation,
    clientId: appointment.clientId,
    caregiverId: appointment.caregiverId,
    carePlanId: appointment.carePlanId,
    coverageRequest,
    completedToday: presentation.completedToday,
    activeToday: presentation.activeToday,
    dailyVisitStatus: presentation.dailyVisitStatus,
    client: {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: nullableDate(client.dateOfBirth),
      gender: client.gender,
      phone: client.phone,
      email: client.email,
      profileImage: client.profileImage,
      notes: client.notes,
      status: client.status,
      languages: [...client.languages]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((language) => ({
          name: language.name,
          proficiency: language.proficiency,
          isPrimary: language.isPrimary,
        })),
      hazards: [...client.hazards]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((hazard) => ({
          type: hazard.type,
          description: hazard.description,
          severity: hazard.severity,
          precautions: hazard.precautions,
          isActive: hazard.isActive,
        })),
      emergencyContacts: [...client.emergencyContacts]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((contact) => ({
          name: contact.name,
          relationship: contact.relationship,
          phone: contact.phone,
          email: contact.email,
          isPrimary: contact.isPrimary,
        })),
      serviceRequirements: [...client.serviceRequirements]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((requirement) => ({
          id: requirement.id,
          service: requirement.service,
          category: requirement.category ?? requirement.service,
          name: requirement.name ?? requirement.service,
          description: requirement.description,
          frequency: requirement.frequency,
          specialInstructions: requirement.specialInstructions,
          isActive: requirement.isActive,
          startTime: nullableDate(requirement.startOn),
          endTime: nullableDate(requirement.endOn),
        })),
      carePlans: [...client.carePlans]
        .sort((left, right) =>
          (nullableDate(left.startDate) ?? "").localeCompare(nullableDate(right.startDate) ?? ""),
        )
        .map((plan) => serializeCarePlan(plan, completions)),
    },
    caregiver: {
      firstName: appointment.caregiver.firstName,
      lastName: appointment.caregiver.lastName,
      phone: appointment.caregiver.phone ?? "",
      email: appointment.caregiver.email,
    },
    tasks,
    services: listedServices(appointment.services),
  };
}

export function listedServices(rows: { service: { id: string; name: string } }[]) {
  return rows
    .map((row) => ({ id: row.service.id, name: row.service.name }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}
