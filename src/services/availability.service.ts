import { randomUUID } from "node:crypto";
import { assertUuid } from "../domain/ids";
import { formatClock, formatDate, nullableDate, parseIsoDate } from "../lib/dates";
import { notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockUser } from "../lib/rowLock";
import { coveringWhere, slotsOverlap } from "./scheduleRules";

export async function requireCaregiver(id: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CAREGIVER") {
    throw notFound();
  }
  return user;
}

function publicWindow(row: { weekday: number; startTime: string; endTime: string }) {
  return { weekday: row.weekday, startTime: formatClock(row.startTime), endTime: formatClock(row.endTime) };
}

function sortWindows<T extends { weekday: number; startTime: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.weekday - right.weekday || left.startTime.localeCompare(right.startTime));
}

export async function getAvailability(caregiverId: string) {
  await requireCaregiver(caregiverId);
  const rows = await prisma.caregiverAvailability.findMany({ where: { caregiverId } });
  return { caregiverId, windows: sortWindows(rows).map(publicWindow) };
}

export async function replaceAvailability(
  caregiverId: string,
  windows: { weekday: number; startTime: string; endTime: string }[],
) {
  await requireCaregiver(caregiverId);
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, caregiverId);
    await tx.caregiverAvailability.deleteMany({ where: { caregiverId } });
    if (windows.length > 0) {
      await tx.caregiverAvailability.createMany({
        data: windows.map((window) => ({ id: randomUUID(), caregiverId, ...window })),
      });
    }
  });
  return getAvailability(caregiverId);
}

function publicTimeOff(row: {
  id: string;
  caregiverId: string;
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
  reason: string;
}) {
  return {
    id: row.id,
    caregiverId: row.caregiverId,
    startDate: formatDate(row.startDate),
    endDate: formatDate(row.endDate),
    startTime: row.startTime === null ? null : formatClock(row.startTime),
    endTime: row.endTime === null ? null : formatClock(row.endTime),
    allDay: row.startTime === null,
    reason: row.reason,
  };
}

export async function listTimeOff(caregiverId: string, range: { from?: string; to?: string }) {
  await requireCaregiver(caregiverId);
  const rows = await prisma.caregiverTimeOff.findMany({
    where: {
      caregiverId,
      ...(range.to ? { startDate: { lte: parseIsoDate(range.to) } } : {}),
      ...(range.from ? { endDate: { gte: parseIsoDate(range.from) } } : {}),
    },
    orderBy: [{ startDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });
  return rows.map(publicTimeOff);
}

export async function createTimeOff(
  caregiverId: string,
  input: { startDate: string; endDate: string; startTime?: string; endTime?: string; reason: string },
) {
  await requireCaregiver(caregiverId);
  const row = await prisma.caregiverTimeOff.create({
    data: {
      id: randomUUID(),
      caregiverId,
      startDate: parseIsoDate(input.startDate),
      endDate: parseIsoDate(input.endDate),
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      reason: input.reason,
    },
  });
  const booked = await prisma.appointment.findMany({
    where: {
      caregiverId,
      appointmentStatus: "scheduled",
      ...coveringWhere(input.startDate, input.endDate),
    },
    include: { client: { select: { firstName: true, lastName: true } } },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });
  const affectedVisits = booked
    .filter(
      (visit) =>
        input.startTime === undefined ||
        input.endTime === undefined ||
        slotsOverlap(
          { startTime: input.startTime, endTime: input.endTime },
          { startTime: visit.startTime, endTime: visit.endTime },
        ),
    )
    .map((visit) => ({
      appointmentId: visit.id,
      scheduledDate: nullableDate(visit.scheduledDate),
      startTime: formatClock(visit.startTime),
      endTime: formatClock(visit.endTime),
      clientName: `${visit.client.firstName} ${visit.client.lastName}`.trim(),
    }));
  return { ...publicTimeOff(row), affectedVisits };
}

export async function deleteTimeOff(caregiverId: string, timeOffId: string): Promise<void> {
  await requireCaregiver(caregiverId);
  assertUuid(timeOffId);
  const deleted = await prisma.caregiverTimeOff.deleteMany({ where: { id: timeOffId, caregiverId } });
  if (deleted.count === 0) {
    throw notFound();
  }
}
