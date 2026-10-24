import { clockMinutes, eachDate, formatClock, formatDate, monthBounds, nullableDate, parseIsoDate } from "../lib/dates";
import { prisma } from "../lib/prisma";
import { listedServices } from "../serializers/appointment";
import { coveringWhere, weekdayOf } from "./scheduleRules";

const DEFAULT_CAREGIVER_LIMIT = 100;

type Interval = [number, number];

function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function toInterval(startTime: string, endTime: string): Interval | null {
  const start = clockMinutes(formatClock(startTime));
  const end = clockMinutes(formatClock(endTime));
  return start === null || end === null || end <= start ? null : [start, end];
}

function subtract(base: Interval[], blocks: Interval[]): Interval[] {
  let result = base;
  for (const [blockStart, blockEnd] of blocks) {
    result = result.flatMap(([start, end]): Interval[] => {
      if (blockEnd <= start || blockStart >= end) return [[start, end]];
      const parts: Interval[] = [];
      if (blockStart > start) parts.push([start, blockStart]);
      if (blockEnd < end) parts.push([blockEnd, end]);
      return parts;
    });
  }
  return result;
}

function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, [start, end]) => sum + (end - start), 0);
}

function visitStatus(
  appointmentStatus: string,
  row: { dailyVisitStatus: string; completed: boolean; checkInAt: Date | null } | undefined,
  date: string,
  today: string,
): string {
  const daily = row?.dailyVisitStatus.toLowerCase() ?? "";
  if (appointmentStatus === "cancelled" || daily === "cancelled" || daily === "canceled") return "cancelled";
  if (appointmentStatus === "completed" || row?.completed || daily === "completed") return "completed";
  if (daily === "missed") return "missed";
  if (row?.checkInAt) return "in_progress";
  if (date < today) return "missed";
  return "scheduled";
}

async function loadCaregivers(caregiverIds: string[] | undefined) {
  return prisma.user.findMany({
    where: caregiverIds
      ? { id: { in: caregiverIds }, role: "CAREGIVER" }
      : { role: "CAREGIVER", status: "active" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    ...(caregiverIds ? {} : { take: DEFAULT_CAREGIVER_LIMIT }),
  });
}

async function buildSchedule(from: string, to: string, caregiverIds: string[] | undefined, today: string) {
  const caregivers = await loadCaregivers(caregiverIds);
  const ids = caregivers.map((caregiver) => caregiver.id);
  const [appointments, windows, timeOff] = await Promise.all([
    prisma.appointment.findMany({
      where: { caregiverId: { in: ids }, ...coveringWhere(from, to) },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        services: { include: { service: true } },
        dailyVisits: {
          where: { serviceDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) } },
        },
      },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    }),
    prisma.caregiverAvailability.findMany({ where: { caregiverId: { in: ids } } }),
    prisma.caregiverTimeOff.findMany({
      where: {
        caregiverId: { in: ids },
        startDate: { lte: parseIsoDate(to) },
        endDate: { gte: parseIsoDate(from) },
      },
      orderBy: [{ startDate: "asc" }, { startTime: "asc" }],
    }),
  ]);
  const dates = eachDate(from, to);

  return caregivers.map((caregiver) => {
    const ownWindows = windows.filter((window) => window.caregiverId === caregiver.id);
    const ownTimeOff = timeOff.filter((entry) => entry.caregiverId === caregiver.id);
    const ownVisits = appointments.filter((appointment) => appointment.caregiverId === caregiver.id);
    const hasAvailability = ownWindows.length > 0;

    const days = dates.map((date) => {
      const weekday = weekdayOf(date);
      const available = ownWindows
        .filter((window) => window.weekday === weekday)
        .map((window) => toInterval(window.startTime, window.endTime))
        .filter((interval): interval is Interval => interval !== null)
        .sort((left, right) => left[0] - right[0]);
      const dayTimeOff = ownTimeOff.filter(
        (entry) => date >= formatDate(entry.startDate) && date <= formatDate(entry.endDate),
      );
      const visits = ownVisits
        .filter((visit) => {
          const start = nullableDate(visit.scheduledDate);
          const end = nullableDate(visit.endDate) ?? start;
          return Boolean(start && end && date >= start && date <= end);
        })
        .map((visit) => {
          const row = visit.dailyVisits.find((daily) => formatDate(daily.serviceDate) === date);
          return {
            appointmentId: visit.id,
            seriesId: visit.seriesId,
            isException: visit.isException,
            date,
            startTime: formatClock(visit.startTime),
            endTime: formatClock(visit.endTime),
            durationMinutes: visit.durationMinutes,
            clientId: visit.client.id,
            clientName: `${visit.client.firstName} ${visit.client.lastName}`.trim(),
            appointmentType: visit.appointmentType,
            appointmentStatus: visit.appointmentStatus,
            visitStatus: visitStatus(visit.appointmentStatus, row, date, today),
            checkInAt: row?.checkInAt?.toISOString() ?? null,
            checkOutAt: row?.checkOutAt?.toISOString() ?? null,
            services: listedServices(visit.services),
            location: {
              street: visit.locationStreet,
              city: visit.locationCity,
              state: visit.locationState,
              zipCode: visit.locationZipCode,
            },
          };
        });

      const offBlocks: Interval[] = dayTimeOff.map((entry) =>
        entry.startTime === null || entry.endTime === null
          ? [0, 24 * 60]
          : (toInterval(entry.startTime, entry.endTime) ?? [0, 0]),
      );
      const bookedBlocks = visits
        .filter((visit) => visit.visitStatus !== "cancelled")
        .map((visit) => toInterval(visit.startTime, visit.endTime))
        .filter((interval): interval is Interval => interval !== null);
      const workable = subtract(available, offBlocks);
      const free = subtract(workable, bookedBlocks);

      return {
        date,
        weekday,
        availability: available.map(([start, end]) => ({ startTime: toClock(start), endTime: toClock(end) })),
        timeOff: dayTimeOff.map((entry) => ({
          id: entry.id,
          startTime: entry.startTime === null ? null : formatClock(entry.startTime),
          endTime: entry.endTime === null ? null : formatClock(entry.endTime),
          allDay: entry.startTime === null,
          reason: entry.reason,
        })),
        visits,
        freeSlots: hasAvailability
          ? free.map(([start, end]) => ({ startTime: toClock(start), endTime: toClock(end) }))
          : null,
        bookedMinutes: totalMinutes(bookedBlocks),
        availableMinutes: hasAvailability ? totalMinutes(workable) : null,
        freeMinutes: hasAvailability ? totalMinutes(free) : null,
      };
    });

    return {
      id: caregiver.id,
      firstName: caregiver.firstName,
      lastName: caregiver.lastName,
      position: caregiver.position ?? "",
      status: caregiver.status,
      hasAvailability,
      days,
    };
  });
}

export async function getSchedule(
  query: { from: string; to: string; caregiverIds?: string[] },
  today: string,
) {
  const caregivers = await buildSchedule(query.from, query.to, query.caregiverIds, today);
  return { from: query.from, to: query.to, caregivers };
}

export async function getScheduleSummary(query: { month: string; caregiverIds?: string[] }, today: string) {
  const { from, to } = monthBounds(`${query.month}-01`);
  const caregivers = await buildSchedule(from, to, query.caregiverIds, today);
  return {
    month: query.month,
    from,
    to,
    caregivers: caregivers.map(({ days, ...caregiver }) => ({
      ...caregiver,
      days: days.map((day) => ({
        date: day.date,
        visitCount: day.visits.filter((visit) => visit.visitStatus !== "cancelled").length,
        completedCount: day.visits.filter((visit) => visit.visitStatus === "completed").length,
        cancelledCount: day.visits.filter((visit) => visit.visitStatus === "cancelled").length,
        missedCount: day.visits.filter((visit) => visit.visitStatus === "missed").length,
        bookedMinutes: day.bookedMinutes,
        availableMinutes: day.availableMinutes,
        freeMinutes: day.freeMinutes,
        hasTimeOff: day.timeOff.length > 0,
      })),
    })),
  };
}
