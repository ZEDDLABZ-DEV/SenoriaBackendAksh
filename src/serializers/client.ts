import { formatClock, nullableDate } from "../lib/dates";
import { serializeCarePlan } from "./carePlan";
import type { ClientGraph, CompletionMap } from "./types";

function address(client: ClientGraph) {
  return {
    street: client.addressStreet,
    apartment: client.addressApartment,
    city: client.addressCity,
    state: client.addressState,
    zipCode: client.addressZipCode,
    country: client.addressCountry,
    gateAccessCode: client.gateAccessCode,
    navigationInstructions: client.navigationInstructions,
    latitude: null,
    longitude: null,
  };
}

export function serializeClientListItem(client: {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  gender: string;
  phone: string;
  email: string | null;
  profileImage: string | null;
  notes: string;
  status: string;
}) {
  return {
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
  };
}

export function serializeClientDetail(
  client: ClientGraph,
  completions: CompletionMap,
  appointments: Array<{
    id: string;
    description: string;
    scheduledDate: Date | null;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    appointmentType: string;
    appointmentStatus: string;
    instructions: string;
    doctorName: string | null;
    doctorSpecialty: string | null;
    doctorPhone: string | null;
    clinicName: string | null;
    caregiverId: string;
    caregiver: { firstName: string; lastName: string };
  }>,
  doctorAppointments: Array<Record<string, unknown>> = [],
) {
  return {
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
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    createdById: client.createdById,
    updatedById: client.updatedById,
    deletedAt: null,
    address: address(client),
    languages: [...client.languages]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((language) => ({
        id: language.id,
        name: language.name,
        proficiency: language.proficiency,
        isPrimary: language.isPrimary,
        clientId: language.clientId,
      })),
    emergencyContacts: [...client.emergencyContacts]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        email: contact.email,
        isPrimary: contact.isPrimary,
        clientId: contact.clientId,
      })),
    diagnoses: [...client.diagnoses]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((diagnosis) => ({
        id: diagnosis.id,
        name: diagnosis.name,
        icdCode: diagnosis.icdCode,
        diagnosedDate: nullableDate(diagnosis.diagnosedDate),
        severity: diagnosis.severity,
        notes: diagnosis.notes,
        isActive: diagnosis.isActive,
        clientId: diagnosis.clientId,
      })),
    hazards: [...client.hazards]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((hazard) => ({
        id: hazard.id,
        type: hazard.type,
        description: hazard.description,
        isActive: hazard.isActive,
        clientId: hazard.clientId,
      })),
    serviceRequirements: [...client.serviceRequirements]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((requirement) => ({
        id: requirement.id,
        category: requirement.category ?? requirement.service,
        name: requirement.name ?? requirement.service,
        description: requirement.description,
        frequency: requirement.frequency,
        specialInstructions: requirement.specialInstructions,
        isActive: requirement.isActive,
        clientId: requirement.clientId,
      })),
    carePlans: [...client.carePlans]
      .sort((left, right) => (nullableDate(left.startDate) ?? "").localeCompare(nullableDate(right.startDate) ?? ""))
      .map((plan) => serializeCarePlan(plan, completions)),
    appointments: appointments.map((appointment) => {
      const summary: Record<string, unknown> = {
        id: appointment.id,
        title: appointment.description,
        description: appointment.description,
        scheduledDate: nullableDate(appointment.scheduledDate),
        startTime: formatClock(appointment.startTime),
        endTime: formatClock(appointment.endTime),
        duration: appointment.durationMinutes,
        appointmentType: appointment.appointmentType,
        appointmentStatus: appointment.appointmentStatus,
        instructions: appointment.instructions,
        caregiverId: appointment.caregiverId,
        caregiver: {
          firstName: appointment.caregiver.firstName,
          lastName: appointment.caregiver.lastName,
        },
      };
      if (appointment.appointmentType.toLowerCase() === "doctor_visit") {
        summary.doctorName = appointment.doctorName;
        summary.doctorSpecialty = appointment.doctorSpecialty;
        summary.doctorPhone = appointment.doctorPhone;
        summary.clinicName = appointment.clinicName;
      }
      return summary;
    }),
    doctorAppointments,
  };
}
