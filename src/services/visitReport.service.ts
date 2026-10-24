import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { clockMinutes, eachDate, formatClock, formatDate, hoursBetween, nullableDate, parseIsoDate } from "../lib/dates";
import { now } from "../lib/clock";
import { conflict, notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { zonedDateTimeToUtc } from "../lib/timezone";
import { assertUuid } from "../domain/ids";
import { pageMeta } from "../validation/common";
import type { ReportFilters } from "../validation/reports";

const MAX_REPORT_DAYS = 2000;
const personSelect = { id: true, firstName: true, lastName: true } as const;

export interface ReportPerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ReportCount {
  completed: number;
  total: number;
}

export interface ReportChecklistItem {
  itemType: "task" | "medication" | "diet" | "hygiene";
  itemId: string;
  carePlanId: string;
  carePlanName: string;
  name: string;
  detail: string;
  completed: boolean;
  completedAt: string | null;
  caregiver: ReportPerson | null;
}

export interface ReportAdjustment {
  id: string;
  adjustedHours: number;
  reason: string;
  createdAt: string;
  admin: ReportPerson;
}

export interface ReportArrival {
  status: "on_time" | "late" | "no_check_in";
  scheduledStart: string | null;
  minutesLate: number;
  minutesEarly: number;
}

export type ReportDayStatus = "completed" | "pending" | "missed" | "cancelled";

export interface ReportDay {
  appointmentId: string;
  dailyVisitId: string | null;
  serviceDate: string;
  status: ReportDayStatus;
  canAdjustHours: boolean;
  caregiver: ReportPerson;
  client: ReportPerson;
  carePlan: { id: string; name: string } | null;
  appointmentType: string;
  description: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledHours: number;
  checkInAt: string | null;
  completedAt: string | null;
  originalHours: number | null;
  adjustedHours: number | null;
  hoursUsed: number | null;
  arrival: ReportArrival;
  counts: {
    tasks: ReportCount;
    medications: ReportCount;
    diet: ReportCount;
    hygiene: ReportCount;
  };
  items: ReportChecklistItem[];
  adjustments: ReportAdjustment[];
  locationStreet: string;
  locationCity: string;
  locationState: string;
  locationZipCode: string;
}

export interface ReportSummary {
  scheduledDays: number;
  completedDays: number;
  pendingDays: number;
  missedDays: number;
  cancelledDays: number;
  totalHours: number;
  averageHours: number | null;
  completionRate: number | null;
}

export interface BuiltVisitReport {
  period: ReportFilters["period"];
  from: string;
  to: string;
  timeZone: string;
  generatedAt: string;
  filters: {
    caregiverId: string | null;
    clientId: string | null;
    caregiverName: string | null;
    clientName: string | null;
    status: ReportFilters["status"];
  };
  summary: ReportSummary;
  rows: ReportDay[];
}

interface ChecklistSource {
  itemType: ReportChecklistItem["itemType"];
  itemId: string;
  carePlanId: string;
  carePlanName: string;
  name: string;
  detail: string;
  sortOrder: number;
}

interface StoredVisit {
  id: string;
  completed: boolean;
  dailyVisitStatus: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  hourAdjustments: Array<{
    id: string;
    adjustedHours: Prisma.Decimal;
    reason: string;
    createdAt: Date;
    admin: ReportPerson;
  }>;
}

function tooLarge(message: string): never {
  throw validation(message, { range: [message] });
}

function classifyDay(
  appointmentStatus: string,
  visit: { completed: boolean; dailyVisitStatus: string } | undefined,
  serviceDate: string,
  today: string,
): ReportDayStatus {
  const visitStatus = visit?.dailyVisitStatus.toLowerCase() ?? "";
  if (appointmentStatus === "cancelled" || visitStatus === "cancelled" || visitStatus === "canceled") {
    return "cancelled";
  }
  if (visit?.completed || visitStatus === "completed" || appointmentStatus === "completed") {
    return "completed";
  }
  if (visitStatus === "missed" || serviceDate < today) {
    return "missed";
  }
  return "pending";
}

function arrivalFor(serviceDate: string, startTime: string, checkInAt: Date | null, timeZone: string): ReportArrival {
  const clock = formatClock(startTime);
  if (clockMinutes(clock) === null) {
    return {
      status: checkInAt ? "on_time" : "no_check_in",
      scheduledStart: null,
      minutesLate: 0,
      minutesEarly: 0,
    };
  }
  const scheduled = zonedDateTimeToUtc(serviceDate, clock, timeZone);
  if (!checkInAt) {
    return {
      status: "no_check_in",
      scheduledStart: scheduled.toISOString(),
      minutesLate: 0,
      minutesEarly: 0,
    };
  }
  const delta = Math.round((checkInAt.getTime() - scheduled.getTime()) / 60000);
  if (delta > 0) {
    return {
      status: "late",
      scheduledStart: scheduled.toISOString(),
      minutesLate: delta,
      minutesEarly: 0,
    };
  }
  return {
    status: "on_time",
    scheduledStart: scheduled.toISOString(),
    minutesLate: 0,
    minutesEarly: -delta,
  };
}

function countItems(items: ReportChecklistItem[], itemType: ReportChecklistItem["itemType"]): ReportCount {
  const matching = items.filter((item) => item.itemType === itemType);
  return {
    completed: matching.filter((item) => item.completed).length,
    total: matching.length,
  };
}

function compareRows(left: ReportDay, right: ReportDay): number {
  if (left.serviceDate !== right.serviceDate) {
    return right.serviceDate.localeCompare(left.serviceDate);
  }
  if (left.scheduledStartTime !== right.scheduledStartTime) {
    return left.scheduledStartTime.localeCompare(right.scheduledStartTime);
  }
  const byCaregiver =
    left.caregiver.lastName.localeCompare(right.caregiver.lastName) ||
    left.caregiver.firstName.localeCompare(right.caregiver.firstName);
  if (byCaregiver !== 0) {
    return byCaregiver;
  }
  return left.appointmentId.localeCompare(right.appointmentId);
}

function summarize(rows: ReportDay[]): ReportSummary {
  let completedDays = 0;
  let pendingDays = 0;
  let missedDays = 0;
  let cancelledDays = 0;
  let totalCents = 0;
  let hoursCount = 0;
  for (const row of rows) {
    if (row.status === "completed") {
      completedDays += 1;
    } else if (row.status === "pending") {
      pendingDays += 1;
    } else if (row.status === "missed") {
      missedDays += 1;
    } else {
      cancelledDays += 1;
    }
    if (row.status === "completed" && row.hoursUsed !== null) {
      totalCents += Math.round(row.hoursUsed * 100);
      hoursCount += 1;
    }
  }
  const scheduledDays = completedDays + pendingDays + missedDays;
  return {
    scheduledDays,
    completedDays,
    pendingDays,
    missedDays,
    cancelledDays,
    totalHours: totalCents / 100,
    averageHours: hoursCount === 0 ? null : Math.round(totalCents / hoursCount) / 100,
    completionRate: scheduledDays === 0 ? null : Math.round((completedDays / scheduledDays) * 10000) / 10000,
  };
}

function detailOrBlank(value: string): string {
  return value.trim();
}

export async function buildVisitReport(filters: ReportFilters, timeZone: string, today: string): Promise<BuiltVisitReport> {
  const rangeStart = parseIsoDate(filters.from);
  const rangeEnd = parseIsoDate(filters.to);
  const appointments = await prisma.appointment.findMany({
    where: {
      scheduledDate: { not: null, lte: rangeEnd },
      ...(filters.caregiverId ? { caregiverId: filters.caregiverId } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      OR: [{ endDate: { gte: rangeStart } }, { endDate: null, scheduledDate: { gte: rangeStart } }],
    },
    include: {
      caregiver: { select: personSelect },
      client: { select: personSelect },
      carePlan: { select: { id: true, name: true } },
      dailyVisits: {
        where: { serviceDate: { gte: rangeStart, lte: rangeEnd } },
        include: {
          hourAdjustments: {
            orderBy: { createdAt: "desc" },
            include: { admin: { select: personSelect } },
          },
        },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  const clientIds = [...new Set(appointments.map((appointment) => appointment.clientId))];
  const plans = clientIds.length
    ? await prisma.carePlan.findMany({
        where: { clientId: { in: clientIds } },
        include: { tasks: true, medications: true, diet: true, hygiene: true },
      })
    : [];
  const planIds = plans.map((plan) => plan.id);
  const completions = planIds.length
    ? await prisma.careItemCompletion.findMany({
        where: {
          carePlanId: { in: planIds },
          serviceDate: { gte: rangeStart, lte: rangeEnd },
        },
        include: { caregiver: { select: personSelect } },
      })
    : [];

  const plansByClient = new Map<string, typeof plans>();
  for (const plan of plans) {
    const list = plansByClient.get(plan.clientId) ?? [];
    list.push(plan);
    plansByClient.set(plan.clientId, list);
  }
  const completionByKey = new Map<string, (typeof completions)[number]>();
  for (const completion of completions) {
    completionByKey.set(`${completion.itemType}:${completion.itemId}:${formatDate(completion.serviceDate)}`, completion);
  }
  const visitsByAppointment = new Map<string, Map<string, StoredVisit>>();
  for (const appointment of appointments) {
    const byDate = new Map<string, StoredVisit>();
    for (const visit of appointment.dailyVisits) {
      byDate.set(formatDate(visit.serviceDate), visit);
    }
    visitsByAppointment.set(appointment.id, byDate);
  }

  const rows: ReportDay[] = [];
  for (const appointment of appointments) {
    const start = nullableDate(appointment.scheduledDate);
    const end = nullableDate(appointment.endDate) ?? start;
    if (!start || !end) {
      continue;
    }
    const windowStart = start > filters.from ? start : filters.from;
    const windowEnd = end < filters.to ? end : filters.to;
    if (windowStart > windowEnd) {
      continue;
    }
    const sources: ChecklistSource[] = [];
    for (const plan of plansByClient.get(appointment.clientId) ?? []) {
      for (const task of plan.tasks) {
        sources.push({
          itemType: "task",
          itemId: task.id,
          carePlanId: plan.id,
          carePlanName: plan.name,
          name: task.name,
          detail: detailOrBlank(task.frequency) || detailOrBlank(task.description),
          sortOrder: task.sortOrder,
        });
      }
      for (const medication of plan.medications) {
        sources.push({
          itemType: "medication",
          itemId: medication.id,
          carePlanId: plan.id,
          carePlanName: plan.name,
          name: medication.medicationName,
          detail: [medication.dosage, medication.schedule].map(detailOrBlank).filter(Boolean).join(", "),
          sortOrder: medication.sortOrder,
        });
      }
      for (const diet of plan.diet) {
        sources.push({
          itemType: "diet",
          itemId: diet.id,
          carePlanId: plan.id,
          carePlanName: plan.name,
          name: diet.meal,
          detail: detailOrBlank(diet.restrictions),
          sortOrder: diet.sortOrder,
        });
      }
      for (const hygiene of plan.hygiene) {
        sources.push({
          itemType: "hygiene",
          itemId: hygiene.id,
          carePlanId: plan.id,
          carePlanName: plan.name,
          name: hygiene.activity,
          detail: detailOrBlank(hygiene.frequency),
          sortOrder: hygiene.sortOrder,
        });
      }
    }
    sources.sort((left, right) => {
      const typeOrder = ["task", "medication", "diet", "hygiene"];
      const byType = typeOrder.indexOf(left.itemType) - typeOrder.indexOf(right.itemType);
      if (byType !== 0) {
        return byType;
      }
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.name.localeCompare(right.name);
    });

    for (const serviceDate of eachDate(windowStart, windowEnd)) {
      const visit = visitsByAppointment.get(appointment.id)?.get(serviceDate);
      const items: ReportChecklistItem[] = sources.map((source) => {
        const completion = completionByKey.get(`${source.itemType}:${source.itemId}:${serviceDate}`);
        const completed = completion?.completed === true;
        return {
          itemType: source.itemType,
          itemId: source.itemId,
          carePlanId: source.carePlanId,
          carePlanName: source.carePlanName,
          name: source.name,
          detail: source.detail,
          completed,
          completedAt: completed ? completion.updatedAt.toISOString() : null,
          caregiver: completed ? completion.caregiver : null,
        };
      });
      const adjustments: ReportAdjustment[] = (visit?.hourAdjustments ?? []).map((adjustment) => ({
        id: adjustment.id,
        adjustedHours: Number(adjustment.adjustedHours.toFixed(2)),
        reason: adjustment.reason,
        createdAt: adjustment.createdAt.toISOString(),
        admin: adjustment.admin,
      }));
      const originalHours = hoursBetween(visit?.checkInAt ?? null, visit?.checkOutAt ?? null);
      const adjustedHours = adjustments[0]?.adjustedHours ?? null;
      const completedVisit = Boolean(visit && (visit.completed || visit.dailyVisitStatus.toLowerCase() === "completed"));
      rows.push({
        appointmentId: appointment.id,
        dailyVisitId: visit?.id ?? null,
        serviceDate,
        status: classifyDay(appointment.appointmentStatus, visit, serviceDate, today),
        canAdjustHours: completedVisit,
        caregiver: appointment.caregiver,
        client: appointment.client,
        carePlan: appointment.carePlan,
        appointmentType: appointment.appointmentType,
        description: appointment.description,
        scheduledStartTime: formatClock(appointment.startTime),
        scheduledEndTime: formatClock(appointment.endTime),
        scheduledHours: Math.round((appointment.durationMinutes / 60) * 100) / 100,
        checkInAt: visit?.checkInAt?.toISOString() ?? null,
        completedAt: visit?.checkOutAt?.toISOString() ?? null,
        originalHours,
        adjustedHours,
        hoursUsed: adjustedHours ?? originalHours,
        arrival: arrivalFor(serviceDate, appointment.startTime, visit?.checkInAt ?? null, timeZone),
        counts: {
          tasks: countItems(items, "task"),
          medications: countItems(items, "medication"),
          diet: countItems(items, "diet"),
          hygiene: countItems(items, "hygiene"),
        },
        items,
        adjustments,
        locationStreet: appointment.locationStreet,
        locationCity: appointment.locationCity,
        locationState: appointment.locationState,
        locationZipCode: appointment.locationZipCode,
      });
      if (rows.length > MAX_REPORT_DAYS) {
        tooLarge("This report is too large. Narrow the date range or filters.");
      }
    }
  }

  const summary = summarize(rows);
  const visible = filters.status === "all" ? rows : rows.filter((row) => row.status === filters.status);
  visible.sort(compareRows);
  const [caregiver, client] = await Promise.all([
    filters.caregiverId
      ? prisma.user.findUnique({ where: { id: filters.caregiverId }, select: personSelect })
      : null,
    filters.clientId
      ? prisma.client.findUnique({
          where: { id: filters.clientId },
          select: { firstName: true, lastName: true },
        })
      : null,
  ]);
  return {
    period: filters.period,
    from: filters.from,
    to: filters.to,
    timeZone,
    generatedAt: now().toISOString(),
    filters: {
      caregiverId: filters.caregiverId,
      clientId: filters.clientId,
      caregiverName: caregiver ? `${caregiver.firstName} ${caregiver.lastName}` : null,
      clientName: client ? `${client.firstName} ${client.lastName}` : null,
      status: filters.status,
    },
    summary,
    rows: visible,
  };
}

export async function visitReport(filters: ReportFilters, page: number, pageSize: number, timeZone: string, today: string) {
  const built = await buildVisitReport(filters, timeZone, today);
  const start = (page - 1) * pageSize;
  return {
    period: built.period,
    from: built.from,
    to: built.to,
    timeZone: built.timeZone,
    generatedAt: built.generatedAt,
    filters: built.filters,
    summary: built.summary,
    data: built.rows.slice(start, start + pageSize),
    meta: pageMeta(page, pageSize, built.rows.length),
  };
}

export async function reportRowForVisit(dailyVisitId: string, timeZone: string, today: string): Promise<ReportDay> {
  const visit = await prisma.appointmentDailyVisit.findUnique({
    where: { id: dailyVisitId },
    select: {
      serviceDate: true,
      appointment: { select: { caregiverId: true, clientId: true } },
    },
  });
  if (!visit) {
    throw notFound();
  }
  const date = formatDate(visit.serviceDate);
  const built = await buildVisitReport(
    {
      period: "daily",
      from: date,
      to: date,
      caregiverId: visit.appointment.caregiverId,
      clientId: visit.appointment.clientId,
      status: "all",
    },
    timeZone,
    today,
  );
  const row = built.rows.find((entry) => entry.dailyVisitId === dailyVisitId);
  if (!row) {
    throw notFound();
  }
  return row;
}

export async function adjustVisitHours(
  adminId: string,
  dailyVisitId: string,
  input: { adjustedHours: number; reason: string },
  timeZone: string,
  today: string,
): Promise<ReportDay> {
  assertUuid(dailyVisitId);
  const existing = await prisma.appointmentDailyVisit.findUnique({ where: { id: dailyVisitId } });
  if (!existing) {
    throw notFound();
  }
  const completed = existing.completed || existing.dailyVisitStatus.toLowerCase() === "completed";
  if (!completed) {
    throw conflict("Hours can be corrected only after the day is marked complete");
  }
  await prisma.$transaction(async (tx) => {
    await tx.visitHourAdjustment.create({
      data: {
        id: randomUUID(),
        dailyVisitId,
        adjustedHours: new Prisma.Decimal(input.adjustedHours.toFixed(2)),
        reason: input.reason,
        adminId,
      },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: adminId,
        action: "visit_hours_adjusted",
        entityType: "appointment_daily_visit",
        entityId: dailyVisitId,
      },
    });
  });
  return reportRowForVisit(dailyVisitId, timeZone, today);
}
