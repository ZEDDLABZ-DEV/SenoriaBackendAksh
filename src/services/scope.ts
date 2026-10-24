import { assertUuid } from "../domain/ids";
import { notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { clientGraphInclude } from "./records";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireSelf(userId: string, caregiverId: string): void {
  if (!UUID_PATTERN.test(caregiverId) || userId !== caregiverId) {
    throw notFound();
  }
}

export async function requireClient(clientId: string) {
  assertUuid(clientId);
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: clientGraphInclude,
  });
  if (!client) {
    throw notFound();
  }
  return client;
}

export async function requireOwnedClient(caregiverId: string, clientId: string) {
  assertUuid(clientId);
  const assignment = await prisma.caregiverClientAssignment.findUnique({
    where: { caregiverId_clientId: { caregiverId, clientId } },
  });
  if (!assignment) {
    throw notFound();
  }
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: clientGraphInclude,
  });
  if (!client) {
    throw notFound();
  }
  return client;
}

export async function requireOwnedAppointment(caregiverId: string, appointmentId: string) {
  assertUuid(appointmentId);
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.caregiverId !== caregiverId) {
    throw notFound();
  }
  return appointment;
}

export async function requireOwnedCarePlan(caregiverId: string, carePlanId: string) {
  assertUuid(carePlanId);
  const carePlan = await prisma.carePlan.findUnique({ where: { id: carePlanId } });
  if (!carePlan) {
    throw notFound();
  }
  const assignment = await prisma.caregiverClientAssignment.findUnique({
    where: { caregiverId_clientId: { caregiverId, clientId: carePlan.clientId } },
  });
  if (!assignment) {
    throw notFound();
  }
  return carePlan;
}
