import type { Prisma } from "@prisma/client";
import { formatDate, parseIsoDate } from "../lib/dates";
import { prisma } from "../lib/prisma";
import type { VisitRow } from "../domain/visit";
import { serializeAppointment } from "../serializers/appointment";
import { completionKey, type AppointmentGraph, type CompletionMap } from "../serializers/types";

export const carePlanInclude = {
  goals: true,
  tasks: true,
  medications: true,
  diet: true,
  hygiene: true,
} satisfies Prisma.CarePlanInclude;

export const clientGraphInclude = {
  languages: true,
  emergencyContacts: true,
  diagnoses: true,
  hazards: true,
  serviceRequirements: true,
  carePlans: { include: carePlanInclude },
} satisfies Prisma.ClientInclude;

export const appointmentGraphInclude = {
  client: { include: clientGraphInclude },
  caregiver: true,
  services: { include: { service: true } },
} satisfies Prisma.AppointmentInclude;

export async function completionMapForClients(clientIds: string[], today: string): Promise<CompletionMap> {
  const map: CompletionMap = new Map();
  if (clientIds.length === 0) {
    return map;
  }
  const rows = await prisma.careItemCompletion.findMany({
    where: {
      serviceDate: parseIsoDate(today),
      completed: true,
      carePlan: { clientId: { in: clientIds } },
    },
  });
  for (const row of rows) {
    map.set(completionKey(row.itemType, row.itemId), true);
  }
  return map;
}

export async function visitsByAppointment(appointmentIds: string[]): Promise<Map<string, VisitRow[]>> {
  const grouped = new Map<string, VisitRow[]>();
  if (appointmentIds.length === 0) {
    return grouped;
  }
  const rows = await prisma.appointmentDailyVisit.findMany({
    where: { appointmentId: { in: appointmentIds } },
  });
  for (const row of rows) {
    const list = grouped.get(row.appointmentId) ?? [];
    list.push({
      serviceDate: formatDate(row.serviceDate),
      dailyVisitStatus: row.dailyVisitStatus,
      completed: row.completed,
      checkInAt: row.checkInAt,
      checkOutAt: row.checkOutAt,
    });
    grouped.set(row.appointmentId, list);
  }
  return grouped;
}

export async function loadAppointmentGraph(id: string): Promise<AppointmentGraph | null> {
  return prisma.appointment.findUnique({
    where: { id },
    include: appointmentGraphInclude,
  });
}

async function openCoverageByAppointment(appointmentIds: string[]) {
  const grouped = new Map<string, { id: string; reason: string; requestedById: string; createdAt: string }>();
  if (appointmentIds.length === 0) {
    return grouped;
  }
  const rows = await prisma.appointmentRelease.findMany({
    where: { appointmentId: { in: appointmentIds }, status: "open" },
    select: { id: true, appointmentId: true, reason: true, requestedById: true, createdAt: true },
  });
  for (const row of rows) {
    grouped.set(row.appointmentId, {
      id: row.id,
      reason: row.reason,
      requestedById: row.requestedById,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return grouped;
}

export async function serializeLoadedAppointments(appointments: AppointmentGraph[], today: string) {
  const ids = appointments.map((appointment) => appointment.id);
  const completions = await completionMapForClients(
    [...new Set(appointments.map((appointment) => appointment.clientId))],
    today,
  );
  const [visits, coverage] = await Promise.all([visitsByAppointment(ids), openCoverageByAppointment(ids)]);
  return appointments.map((appointment) =>
    serializeAppointment(
      appointment,
      completions,
      visits.get(appointment.id) ?? [],
      today,
      coverage.get(appointment.id) ?? null,
    ),
  );
}
