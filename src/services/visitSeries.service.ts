import { randomUUID } from "node:crypto";
import type { Prisma, VisitSeries } from "@prisma/client";
import { assertUuid } from "../domain/ids";
import { addDays, eachDate, formatClock, formatDate, nullableDate, parseIsoDate } from "../lib/dates";
import { conflict, notFound, scheduleConflicts, scheduleWarnings, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockUser } from "../lib/rowLock";
import {
  MAX_SERIES_DAYS,
  weekdaysForDates,
  type CreateSeriesInput,
  type UpdateSeriesInput,
} from "../validation/schedule";
import {
  ensureAssignment,
  normalizeType,
  requireActiveCaregiver,
  requireClientRow,
} from "./appointmentAdmin.service";
import { requireServiceIds } from "./careService.service";
import { closeOpenCoverageForAppointments } from "./coverage.service";
import { deliveringTransaction } from "./push.service";
import {
  findConflicts,
  findWarnings,
  slotMinutes,
  weekdayOf,
  type Occurrence,
  type ScheduleConflict,
  type TimeSlot,
} from "./scheduleRules";

type Tx = Prisma.TransactionClient;

export { MAX_SERIES_DAYS };
const TRANSACTION_OPTIONS = { timeout: 30_000 };

interface Template {
  clientId: string;
  caregiverId: string;
  weekdays: number[];
  timeSlots: TimeSlot[];
  serviceIds: string[];
  appointmentType: string;
  description: string;
  instructions: string;
  notes: string;
  locationStreet: string;
  locationCity: string;
  locationState: string;
  locationZipCode: string;
  locationGateCode: string;
  locationNavigation: string;
}

interface PlannedVisit extends Occurrence {
  slot: number;
}

function sortSlots(slots: TimeSlot[]): TimeSlot[] {
  return [...slots]
    .map((slot) => ({ startTime: formatClock(slot.startTime), endTime: formatClock(slot.endTime) }))
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

function readSlots(value: Prisma.JsonValue): TimeSlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const { startTime, endTime } = entry as Record<string, unknown>;
      if (typeof startTime === "string" && typeof endTime === "string") {
        return [{ startTime, endTime }];
      }
    }
    return [];
  });
}

function key(date: string, slot: number): string {
  return `${date}#${slot}`;
}

function visitsOnDates(template: Template, dates: string[]): PlannedVisit[] {
  const slots = sortSlots(template.timeSlots);
  return dates.flatMap((date) => slots.map((slot, index) => ({ date, slot: index, ...slot })));
}

function planVisits(template: Template, from: string, to: string): PlannedVisit[] {
  const weekdays = new Set(template.weekdays);
  return visitsOnDates(
    template,
    eachDate(from, to).filter((date) => weekdays.has(weekdayOf(date))),
  );
}

function readDates(values: Date[]): string[] {
  return values.map((date) => formatDate(date)).sort();
}

function assertRangeLength(from: string, to: string, field: string) {
  if (to < from) {
    throw validation("End date must be on or after the start date", {
      [field]: ["End date must be on or after the start date"],
    });
  }
  if (addDays(from, MAX_SERIES_DAYS - 1) < to) {
    throw validation(`A schedule can cover at most ${MAX_SERIES_DAYS} days at a time`, {
      [field]: [`A schedule can cover at most ${MAX_SERIES_DAYS} days at a time`],
    });
  }
}

function conflictKeys(conflicts: ScheduleConflict[], planned: PlannedVisit[]): Set<string> {
  const keys = new Set<string>();
  for (const item of conflicts) {
    const match = planned.find(
      (visit) => visit.date === item.date && visit.startTime === item.startTime && visit.endTime === item.endTime,
    );
    if (match) keys.add(key(match.date, match.slot));
  }
  return keys;
}

async function checkPlanned(
  tx: Tx,
  caregiverId: string,
  planned: PlannedVisit[],
  options: { ignoreIds?: string[]; skipConflicts: boolean; acknowledgeWarnings: boolean },
) {
  const conflicts = await findConflicts(tx, caregiverId, planned, options.ignoreIds);
  if (conflicts.length > 0 && !options.skipConflicts) {
    throw scheduleConflicts(conflicts);
  }
  const skippedKeys = conflictKeys(conflicts, planned);
  const accepted = planned.filter((visit) => !skippedKeys.has(key(visit.date, visit.slot)));
  const warnings = await findWarnings(tx, caregiverId, accepted);
  if (warnings.length > 0 && !options.acknowledgeWarnings) {
    throw scheduleWarnings(warnings);
  }
  return { accepted, conflicts, warnings };
}

async function createOccurrences(tx: Tx, seriesId: string, template: Template, visits: PlannedVisit[]) {
  if (visits.length === 0) return;
  const plan = await tx.carePlan.findFirst({ where: { clientId: template.clientId }, orderBy: { id: "asc" } });
  const services = await tx.careService.findMany({
    where: { id: { in: template.serviceIds } },
    select: { id: true },
  });
  const rows = visits.map((visit) => {
    const { start, end } = slotMinutes(visit);
    return {
      id: randomUUID(),
      clientId: template.clientId,
      caregiverId: template.caregiverId,
      carePlanId: plan?.id ?? null,
      description: template.description,
      scheduledDate: parseIsoDate(visit.date),
      endDate: parseIsoDate(visit.date),
      startTime: visit.startTime,
      endTime: visit.endTime,
      durationMinutes: end - start,
      appointmentType: template.appointmentType,
      appointmentStatus: "scheduled",
      recordStatus: "active",
      instructions: template.instructions,
      notes: template.notes,
      locationStreet: template.locationStreet,
      locationCity: template.locationCity,
      locationState: template.locationState,
      locationZipCode: template.locationZipCode,
      locationGateCode: template.locationGateCode,
      locationNavigation: template.locationNavigation,
      seriesId,
      seriesDate: parseIsoDate(visit.date),
      seriesSlot: visit.slot,
    };
  });
  await tx.appointment.createMany({ data: rows });
  if (services.length > 0) {
    await tx.appointmentService.createMany({
      data: rows.flatMap((row) => services.map((service) => ({ appointmentId: row.id, serviceId: service.id }))),
    });
  }
}

function templateOf(series: VisitSeries): Template {
  return {
    clientId: series.clientId,
    caregiverId: series.caregiverId,
    weekdays: series.weekdays,
    timeSlots: readSlots(series.timeSlots),
    serviceIds: series.serviceIds,
    appointmentType: series.appointmentType,
    description: series.description,
    instructions: series.instructions,
    notes: series.notes,
    locationStreet: series.locationStreet,
    locationCity: series.locationCity,
    locationState: series.locationState,
    locationZipCode: series.locationZipCode,
    locationGateCode: series.locationGateCode,
    locationNavigation: series.locationNavigation,
  };
}

function untouchedWhere(seriesId: string, fromDate: string, includeExceptions: boolean): Prisma.AppointmentWhereInput {
  return {
    seriesId,
    seriesDate: { gte: parseIsoDate(fromDate) },
    appointmentStatus: "scheduled",
    dailyVisits: { none: {} },
    checkIns: { none: {} },
    ...(includeExceptions ? {} : { isException: false }),
  };
}

async function removeAppointments(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  await closeOpenCoverageForAppointments(tx, ids, "deleted");
  await tx.appointmentService.deleteMany({ where: { appointmentId: { in: ids } } });
  await tx.appointment.deleteMany({ where: { id: { in: ids } } });
}

function defaultFromDate(series: VisitSeries, today: string): string {
  const start = formatDate(series.startDate);
  return start > today ? start : today;
}

function assertFromDate(fromDate: string, series: VisitSeries, today: string) {
  if (fromDate < today) {
    throw validation("Past visits cannot be changed", { fromDate: ["fromDate cannot be in the past"] });
  }
  if (fromDate < formatDate(series.startDate)) {
    throw validation("fromDate is before the schedule starts", {
      fromDate: ["fromDate is before the schedule starts"],
    });
  }
}

const seriesInclude = {
  client: { select: { firstName: true, lastName: true } },
  caregiver: { select: { firstName: true, lastName: true } },
} satisfies Prisma.VisitSeriesInclude;

type SeriesWithNames = Prisma.VisitSeriesGetPayload<{ include: typeof seriesInclude }>;

function serializeSeries(series: SeriesWithNames) {
  return {
    id: series.id,
    clientId: series.clientId,
    clientName: `${series.client.firstName} ${series.client.lastName}`.trim(),
    caregiverId: series.caregiverId,
    caregiverName: `${series.caregiver.firstName} ${series.caregiver.lastName}`.trim(),
    startDate: formatDate(series.startDate),
    endDate: formatDate(series.endDate),
    weekdays: [...series.weekdays].sort((left, right) => left - right),
    dates: series.selectedDates.length > 0 ? readDates(series.selectedDates) : null,
    timeSlots: sortSlots(readSlots(series.timeSlots)),
    serviceIds: series.serviceIds,
    appointmentType: series.appointmentType,
    description: series.description,
    instructions: series.instructions,
    notes: series.notes,
    locationStreet: series.locationStreet,
    locationCity: series.locationCity,
    locationState: series.locationState,
    locationZipCode: series.locationZipCode,
    locationGateCode: series.locationGateCode,
    locationNavigation: series.locationNavigation,
    status: series.status,
  };
}

function publicConflicts(conflicts: ScheduleConflict[]) {
  return conflicts.map((item) => ({
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    appointmentId: item.appointmentId,
    clientName: item.clientName,
    existingStartTime: item.existingStartTime,
    existingEndTime: item.existingEndTime,
  }));
}

async function loadSeries(id: string) {
  assertUuid(id);
  const series = await prisma.visitSeries.findUnique({ where: { id }, include: seriesInclude });
  if (!series) throw notFound();
  return series;
}

export async function getSeries(id: string) {
  const series = await loadSeries(id);
  const occurrences = await prisma.appointment.findMany({
    where: { seriesId: id },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });
  return {
    ...serializeSeries(series),
    occurrences: occurrences.map((row) => ({
      appointmentId: row.id,
      date: nullableDate(row.scheduledDate),
      startTime: formatClock(row.startTime),
      endTime: formatClock(row.endTime),
      caregiverId: row.caregiverId,
      appointmentStatus: row.appointmentStatus,
      isException: row.isException,
    })),
  };
}

export async function listSeries(filters: { caregiverId?: string; clientId?: string; status?: string }) {
  const rows = await prisma.visitSeries.findMany({
    where: {
      ...(filters.caregiverId ? { caregiverId: filters.caregiverId } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: seriesInclude,
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    take: 200,
  });
  return rows.map(serializeSeries);
}

export async function createSeries(input: CreateSeriesInput, today: string) {
  const client = await requireClientRow(input.clientId);
  await requireActiveCaregiver(input.caregiverId);
  const serviceIds = await requireServiceIds(input.serviceIds);
  if (input.dates) {
    if (input.dates.some((date) => date < today)) {
      throw validation("A schedule cannot include past dates", { dates: ["dates cannot be in the past"] });
    }
    assertRangeLength(input.startDate, input.endDate, "dates");
  } else if (input.startDate < today) {
    throw validation("A schedule cannot start in the past", { startDate: ["startDate cannot be in the past"] });
  } else {
    assertRangeLength(input.startDate, input.endDate, "endDate");
  }

  const template: Template = {
    clientId: input.clientId,
    caregiverId: input.caregiverId,
    weekdays: [...new Set(input.weekdays)],
    timeSlots: sortSlots(input.timeSlots),
    serviceIds,
    appointmentType: normalizeType(input.appointmentType),
    description: input.description,
    instructions: input.instructions,
    notes: input.notes,
    locationStreet: input.locationStreet ?? client.addressStreet,
    locationCity: input.locationCity ?? client.addressCity,
    locationState: input.locationState ?? client.addressState,
    locationZipCode: input.locationZipCode ?? client.addressZipCode,
    locationGateCode: input.locationGateCode ?? client.gateAccessCode,
    locationNavigation: input.locationNavigation ?? client.navigationInstructions,
  };
  const planned = input.dates ? visitsOnDates(template, input.dates) : planVisits(template, input.startDate, input.endDate);
  if (planned.length === 0) {
    throw validation("None of the chosen days fall between the start and end dates", {
      weekdays: ["None of the chosen days fall between the start and end dates"],
    });
  }

  const id = randomUUID();
  const outcome = await deliveringTransaction(async (tx) => {
    await lockUser(tx, template.caregiverId);
    const checked = await checkPlanned(tx, template.caregiverId, planned, {
      skipConflicts: input.skipConflicts,
      acknowledgeWarnings: input.acknowledgeWarnings,
    });
    if (checked.accepted.length === 0) {
      throw scheduleConflicts(checked.conflicts);
    }
    await ensureAssignment(tx, template.caregiverId, template.clientId);
    await tx.visitSeries.create({
      data: {
        id,
        ...template,
        timeSlots: template.timeSlots as unknown as Prisma.InputJsonValue,
        startDate: parseIsoDate(input.startDate),
        endDate: parseIsoDate(input.endDate),
        selectedDates: (input.dates ?? []).map((date) => parseIsoDate(date)),
        status: "active",
      },
    });
    await createOccurrences(tx, id, template, checked.accepted);
    return checked;
  }, TRANSACTION_OPTIONS);

  return {
    series: serializeSeries(await loadSeries(id)),
    createdCount: outcome.accepted.length,
    skipped: publicConflicts(outcome.conflicts),
    warnings: outcome.warnings,
  };
}

export async function updateSeries(id: string, input: UpdateSeriesInput, today: string) {
  const current = await loadSeries(id);
  if (current.status !== "active") {
    throw conflict("This schedule has ended and cannot be changed");
  }
  const fromDate = input.fromDate ?? defaultFromDate(current, today);
  assertFromDate(fromDate, current, today);
  const storedDates = readDates(current.selectedDates);
  const picked = storedDates.length > 0;
  if (picked && (input.weekdays !== undefined || input.endDate !== undefined)) {
    throw validation("This schedule uses specific dates", {
      dates: ["Change the selected dates instead of the repeating range"],
    });
  }
  if (!picked && input.dates !== undefined) {
    throw validation("This schedule uses a repeating range", {
      dates: ["Change the start date, end date, or repeat days instead of specific dates"],
    });
  }
  let selectedDates = storedDates;
  if (picked && input.dates) {
    const alreadySaved = new Set(storedDates);
    if (input.dates.some((date) => date < fromDate && !alreadySaved.has(date))) {
      throw validation("Past visits cannot be changed", { dates: ["dates must be on or after fromDate"] });
    }
    const futureDates = input.dates.filter((date) => date >= fromDate);
    if (futureDates.length === 0) {
      throw validation("Choose at least one date", { dates: ["Choose at least one date on or after fromDate"] });
    }
    selectedDates = [...storedDates.filter((date) => date < fromDate), ...futureDates].sort();
    assertRangeLength(selectedDates[0], selectedDates[selectedDates.length - 1], "dates");
  }
  const endDate = picked ? selectedDates[selectedDates.length - 1] : (input.endDate ?? formatDate(current.endDate));
  if (!picked) {
    assertRangeLength(fromDate, endDate, "endDate");
  }
  if (input.caregiverId && input.caregiverId !== current.caregiverId) {
    await requireActiveCaregiver(input.caregiverId);
  }
  const previous = templateOf(current);
  const template: Template = {
    ...previous,
    caregiverId: input.caregiverId ?? previous.caregiverId,
    weekdays: picked ? weekdaysForDates(selectedDates) : input.weekdays ? [...new Set(input.weekdays)] : previous.weekdays,
    timeSlots: input.timeSlots ? sortSlots(input.timeSlots) : previous.timeSlots,
    serviceIds: input.serviceIds ? await requireServiceIds(input.serviceIds) : previous.serviceIds,
    appointmentType:
      input.appointmentType !== undefined ? normalizeType(input.appointmentType) : previous.appointmentType,
    description: input.description ?? previous.description,
    instructions: input.instructions ?? previous.instructions,
    notes: input.notes ?? previous.notes,
    locationStreet: input.locationStreet ?? previous.locationStreet,
    locationCity: input.locationCity ?? previous.locationCity,
    locationState: input.locationState ?? previous.locationState,
    locationZipCode: input.locationZipCode ?? previous.locationZipCode,
    locationGateCode: input.locationGateCode ?? previous.locationGateCode,
    locationNavigation: input.locationNavigation ?? previous.locationNavigation,
  };

  const outcome = await deliveringTransaction(async (tx) => {
    for (const caregiverId of [...new Set([current.caregiverId, template.caregiverId])].sort()) {
      await lockUser(tx, caregiverId);
    }
    const removable = await tx.appointment.findMany({
      where: untouchedWhere(id, fromDate, false),
      select: { id: true },
    });
    const removableIds = removable.map((row) => row.id);
    const kept = await tx.appointment.findMany({
      where: { seriesId: id, seriesDate: { gte: parseIsoDate(fromDate) }, id: { notIn: removableIds } },
      select: { seriesDate: true, seriesSlot: true },
    });
    const excluded = await tx.visitSeriesExclusion.findMany({
      where: { seriesId: id, seriesDate: { gte: parseIsoDate(fromDate) } },
    });
    const taken = new Set([
      ...kept.map((row) => key(nullableDate(row.seriesDate) ?? "", row.seriesSlot ?? -1)),
      ...excluded.map((row) => key(formatDate(row.seriesDate), row.seriesSlot)),
    ]);
    const planned = (picked
      ? visitsOnDates(
          template,
          selectedDates.filter((date) => date >= fromDate),
        )
      : planVisits(template, fromDate, endDate)
    ).filter((visit) => !taken.has(key(visit.date, visit.slot)));
    const checked = await checkPlanned(tx, template.caregiverId, planned, {
      ignoreIds: removableIds,
      skipConflicts: input.skipConflicts,
      acknowledgeWarnings: input.acknowledgeWarnings,
    });
    await removeAppointments(tx, removableIds);
    await tx.visitSeries.update({
      where: { id },
      data: {
        ...template,
        timeSlots: template.timeSlots as unknown as Prisma.InputJsonValue,
        endDate: parseIsoDate(endDate),
        ...(picked
          ? {
              startDate: parseIsoDate(selectedDates[0]),
              selectedDates: selectedDates.map((date) => parseIsoDate(date)),
            }
          : {}),
      },
    });
    if (checked.accepted.length > 0) {
      await ensureAssignment(tx, template.caregiverId, template.clientId);
    }
    await createOccurrences(tx, id, template, checked.accepted);
    return { ...checked, removedCount: removableIds.length };
  }, TRANSACTION_OPTIONS);

  return {
    series: serializeSeries(await loadSeries(id)),
    fromDate,
    removedCount: outcome.removedCount,
    createdCount: outcome.accepted.length,
    skipped: publicConflicts(outcome.conflicts),
    warnings: outcome.warnings,
  };
}

export async function endSeries(id: string, fromDateInput: string | undefined, today: string) {
  const current = await loadSeries(id);
  const fromDate = fromDateInput ?? defaultFromDate(current, today);
  assertFromDate(fromDate, current, today);
  const start = formatDate(current.startDate);
  const end = formatDate(current.endDate);
  const dayBefore = addDays(fromDate, -1);
  const lastDay = dayBefore < end ? dayBefore : end;

  const removedCount = await deliveringTransaction(async (tx) => {
    await lockUser(tx, current.caregiverId);
    const removable = await tx.appointment.findMany({
      where: untouchedWhere(id, fromDate, true),
      select: { id: true },
    });
    await removeAppointments(
      tx,
      removable.map((row) => row.id),
    );
    const storedDates = readDates(current.selectedDates);
    const remaining = storedDates.filter((date) => date < fromDate);
    const keptDates = storedDates.length === 0 ? [] : remaining.length > 0 ? remaining : [start];
    await tx.visitSeries.update({
      where: { id },
      data: {
        status: "ended",
        endDate: parseIsoDate(lastDay >= start ? lastDay : start),
        ...(keptDates.length > 0
          ? { selectedDates: keptDates.map((date) => parseIsoDate(date)), weekdays: weekdaysForDates(keptDates) }
          : {}),
      },
    });
    return removable.length;
  }, TRANSACTION_OPTIONS);

  return { series: serializeSeries(await loadSeries(id)), removedCount };
}
