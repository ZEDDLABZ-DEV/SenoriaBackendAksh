import type { Prisma } from "@prisma/client";
import { clockMinutes, formatClock, formatDate, nullableDate, parseIsoDate } from "../lib/dates";
import { scheduleConflicts, scheduleWarnings, validation } from "../lib/errors";

type Tx = Prisma.TransactionClient;

export interface TimeSlot {
  startTime: string;
  endTime: string;
}

export interface Occurrence extends TimeSlot {
  date: string;
}

export interface ScheduleConflict extends Occurrence {
  appointmentId: string;
  clientId: string;
  clientName: string;
  existingStartTime: string;
  existingEndTime: string;
}

export type ScheduleWarning =
  | (Occurrence & { type: "outside_hours" })
  | (Occurrence & { type: "time_off"; timeOffId: string; reason: string });

export function weekdayOf(date: string): number {
  return parseIsoDate(date).getUTCDay();
}

export function slotMinutes(slot: TimeSlot): { start: number; end: number } {
  const start = clockMinutes(formatClock(slot.startTime));
  const end = clockMinutes(formatClock(slot.endTime));
  if (start === null || end === null || end <= start) {
    throw validation("End time must be after start time", {
      endTime: ["End time must be after start time"],
    });
  }
  return { start, end };
}

export function slotsOverlap(left: TimeSlot, right: TimeSlot): boolean {
  const a = slotMinutes(left);
  const b = slotMinutes(right);
  return a.start < b.end && b.start < a.end;
}

function dateBounds(occurrences: Occurrence[]): { from: string; to: string } {
  const dates = occurrences.map((occurrence) => occurrence.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

export function coveringWhere(from: string, to: string): Prisma.AppointmentWhereInput {
  return {
    scheduledDate: { lte: parseIsoDate(to) },
    OR: [
      { endDate: { gte: parseIsoDate(from) } },
      { endDate: null, scheduledDate: { gte: parseIsoDate(from) } },
    ],
  };
}

export async function findConflicts(
  tx: Tx,
  caregiverId: string,
  occurrences: Occurrence[],
  ignoreIds: string[] = [],
): Promise<ScheduleConflict[]> {
  if (occurrences.length === 0) {
    return [];
  }
  occurrences.forEach(slotMinutes);
  const { from, to } = dateBounds(occurrences);
  const rows = await tx.appointment.findMany({
    where: {
      caregiverId,
      appointmentStatus: { not: "cancelled" },
      ...(ignoreIds.length > 0 ? { id: { notIn: ignoreIds } } : {}),
      ...coveringWhere(from, to),
    },
    include: { client: { select: { id: true, firstName: true, lastName: true } } },
  });
  const conflicts: ScheduleConflict[] = [];
  for (const occurrence of occurrences) {
    for (const row of rows) {
      const start = nullableDate(row.scheduledDate);
      const end = nullableDate(row.endDate) ?? start;
      if (!start || !end || occurrence.date < start || occurrence.date > end) {
        continue;
      }
      const existing = { startTime: formatClock(row.startTime), endTime: formatClock(row.endTime) };
      if (clockMinutes(existing.startTime) === null || clockMinutes(existing.endTime) === null) {
        continue;
      }
      if (slotsOverlap(occurrence, existing)) {
        conflicts.push({
          ...occurrence,
          appointmentId: row.id,
          clientId: row.client.id,
          clientName: `${row.client.firstName} ${row.client.lastName}`.trim(),
          existingStartTime: existing.startTime,
          existingEndTime: existing.endTime,
        });
      }
    }
  }
  return conflicts;
}

export async function findWarnings(
  tx: Tx,
  caregiverId: string,
  occurrences: Occurrence[],
): Promise<ScheduleWarning[]> {
  if (occurrences.length === 0) {
    return [];
  }
  const { from, to } = dateBounds(occurrences);
  const [windows, timeOff] = await Promise.all([
    tx.caregiverAvailability.findMany({ where: { caregiverId } }),
    tx.caregiverTimeOff.findMany({
      where: {
        caregiverId,
        startDate: { lte: parseIsoDate(to) },
        endDate: { gte: parseIsoDate(from) },
      },
    }),
  ]);
  const warnings: ScheduleWarning[] = [];
  for (const occurrence of occurrences) {
    const { start, end } = slotMinutes(occurrence);
    if (windows.length > 0) {
      const weekday = weekdayOf(occurrence.date);
      const inside = windows.some((window) => {
        if (window.weekday !== weekday) return false;
        const bounds = slotMinutes(window);
        return bounds.start <= start && end <= bounds.end;
      });
      if (!inside) {
        warnings.push({ type: "outside_hours", ...occurrence });
      }
    }
    for (const entry of timeOff) {
      if (occurrence.date < formatDate(entry.startDate) || occurrence.date > formatDate(entry.endDate)) {
        continue;
      }
      const blocks =
        entry.startTime === null || entry.endTime === null
          ? true
          : slotsOverlap(occurrence, { startTime: entry.startTime, endTime: entry.endTime });
      if (blocks) {
        warnings.push({ type: "time_off", ...occurrence, timeOffId: entry.id, reason: entry.reason });
      }
    }
  }
  return warnings;
}

export async function assertSchedulable(
  tx: Tx,
  caregiverId: string,
  occurrences: Occurrence[],
  options: { ignoreIds?: string[]; acknowledgeWarnings?: boolean } = {},
): Promise<ScheduleWarning[]> {
  const conflicts = await findConflicts(tx, caregiverId, occurrences, options.ignoreIds);
  if (conflicts.length > 0) {
    throw scheduleConflicts(conflicts);
  }
  const warnings = await findWarnings(tx, caregiverId, occurrences);
  if (warnings.length > 0 && !options.acknowledgeWarnings) {
    throw scheduleWarnings(warnings);
  }
  return warnings;
}
