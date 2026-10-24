import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { APPOINTMENT_TYPE_VALUES } from "../domain/enums";
import { assertUuid } from "../domain/ids";
import { clockMinutes, formatClock, formatDate, nullableDate, parseIsoDate } from "../lib/dates";
import { notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockAppointment, lockUser } from "../lib/rowLock";
import { pageMeta, type PageQuery } from "../validation/common";
import { listedServices } from "../serializers/appointment";
import { getAppointment } from "./appointment.service";
import { closeOpenCoverageForAppointments } from "./coverage.service";
import { deliveringTransaction } from "./push.service";
import { requireServiceIds } from "./careService.service";
import { assertSchedulable } from "./scheduleRules";

type Tx = Prisma.TransactionClient;

export function normalizeType(value: string): string {
  const type = value.trim() === "" ? "regular_visit" : value.trim();
  if (!(APPOINTMENT_TYPE_VALUES as readonly string[]).includes(type)) {
    throw validation("appointmentType is not recognized", {
      appointmentType: ["appointmentType is not recognized"],
    });
  }
  return type;
}

export async function requireActiveCaregiver(id: string) {
  try {
    assertUuid(id);
  } catch {
    throw validation("caregiverId is not valid", { caregiverId: ["caregiverId is not valid"] });
  }
  const caregiver = await prisma.user.findUnique({ where: { id } });
  if (!caregiver || caregiver.role !== "CAREGIVER" || caregiver.status !== "active") {
    throw validation("Choose an active caregiver", { caregiverId: ["Choose an active caregiver"] });
  }
  return caregiver;
}

export async function ensureAssignment(tx: Tx, caregiverId: string, clientId: string) {
  await tx.caregiverClientAssignment.upsert({
    where: { caregiverId_clientId: { caregiverId, clientId } },
    create: { id: randomUUID(), caregiverId, clientId },
    update: {},
  });
}

export async function requireClientRow(id: string) {
  try {
    assertUuid(id);
  } catch {
    throw validation("clientId is not valid", { clientId: ["clientId is not valid"] });
  }
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    throw validation("Client was not found", { clientId: ["Client was not found"] });
  }
  return client;
}

export async function listAppointmentsAdmin(query: PageQuery) {
  const where = query.search
    ? {
        client: {
          OR: [
            { firstName: { contains: query.search, mode: "insensitive" as const } },
            { lastName: { contains: query.search, mode: "insensitive" as const } },
          ],
        },
      }
    : {};
  const total = await prisma.appointment.count({ where });
  const rows = await prisma.appointment.findMany({
    where,
    include: { client: true, caregiver: true, services: { include: { service: true } } },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map((row) => ({
      id: row.id,
      scheduledDate: row.scheduledDate ? `${formatDate(row.scheduledDate)}T00:00:00.000Z` : null,
      startTime: formatClock(row.startTime),
      endTime: formatClock(row.endTime),
      clientName: `${row.client.firstName} ${row.client.lastName}`.trim(),
      caregiverId: row.caregiverId,
      caregiverName: `${row.caregiver.firstName} ${row.caregiver.lastName}`.trim(),
      status: row.appointmentStatus,
      type: row.appointmentType,
      services: listedServices(row.services),
    })),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export function appointmentTypes() {
  return [
    { value: "regular_visit", label: "Regular Visit" },
    { value: "doctor_visit", label: "Doctor Visit" },
  ];
}

export async function createAppointment(input: {
  description?: string;
  clientId: string;
  caregiverId: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  appointmentType?: string;
  instructions?: string;
  notes?: string;
  locationStreet?: string;
  locationCity?: string;
  locationState?: string;
  locationZipCode?: string;
  locationGateCode?: string;
  locationNavigation?: string;
  serviceIds?: string[];
  acknowledgeWarnings?: boolean;
}) {
  await requireClientRow(input.clientId);
  await requireActiveCaregiver(input.caregiverId);
  const serviceIds = await requireServiceIds(input.serviceIds ?? []);
  const appointmentType = normalizeType(input.appointmentType ?? "");
  const id = randomUUID();
  const warnings = await prisma.$transaction(async (tx) => {
    await lockUser(tx, input.caregiverId);
    const found = await assertSchedulable(
      tx,
      input.caregiverId,
      [{ date: input.scheduledDate, startTime: input.startTime, endTime: input.endTime }],
      { acknowledgeWarnings: input.acknowledgeWarnings },
    );
    await ensureAssignment(tx, input.caregiverId, input.clientId);
    const plan = await tx.carePlan.findFirst({
      where: { clientId: input.clientId },
      orderBy: { id: "asc" },
    });
    const start = clockMinutes(input.startTime) ?? 0;
    const end = clockMinutes(input.endTime) ?? 0;
    await tx.appointment.create({
      data: {
        id,
        clientId: input.clientId,
        caregiverId: input.caregiverId,
        carePlanId: plan?.id ?? null,
        description: input.description ?? "",
        scheduledDate: parseIsoDate(input.scheduledDate),
        endDate: parseIsoDate(input.scheduledDate),
        startTime: input.startTime,
        endTime: input.endTime,
        durationMinutes: end - start,
        appointmentType,
        appointmentStatus: "scheduled",
        recordStatus: "active",
        instructions: input.instructions ?? "",
        notes: input.notes ?? "",
        locationStreet: input.locationStreet ?? "",
        locationCity: input.locationCity ?? "",
        locationState: input.locationState ?? "",
        locationZipCode: input.locationZipCode ?? "",
        locationGateCode: input.locationGateCode ?? "",
        locationNavigation: input.locationNavigation ?? "",
      },
    });
    if (serviceIds.length > 0) {
      await tx.appointmentService.createMany({
        data: serviceIds.map((serviceId) => ({ appointmentId: id, serviceId })),
      });
    }
    return found;
  });
  return { id, warnings };
}

export async function updateAppointmentAdmin(
  appointmentId: string,
  present: Record<string, unknown>,
  value: {
    description?: string;
    clientId?: string;
    caregiverId?: string;
    scheduledDate?: string;
    startTime?: string;
    endTime?: string;
    appointmentType?: string;
    instructions?: string;
    notes?: string;
    locationStreet?: string;
    locationCity?: string;
    locationState?: string;
    locationZipCode?: string;
    locationGateCode?: string;
    locationNavigation?: string;
    appointmentStatus?: "scheduled" | "completed" | "cancelled";
    serviceIds?: string[];
    acknowledgeWarnings?: boolean;
  },
  today: string,
) {
  assertUuid(appointmentId);
  const nextServiceIds =
    "serviceIds" in present ? await requireServiceIds(value.serviceIds ?? []) : undefined;
  if ("clientId" in present && value.clientId) {
    await requireClientRow(value.clientId);
  }
  if ("caregiverId" in present && value.caregiverId) {
    await requireActiveCaregiver(value.caregiverId);
  }
  await deliveringTransaction(async (tx) => {
    await lockAppointment(tx, appointmentId);
    const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!current) {
      throw notFound();
    }
    const caregiverId = "caregiverId" in present && value.caregiverId ? value.caregiverId : current.caregiverId;
    const clientId = "clientId" in present && value.clientId ? value.clientId : current.clientId;
    await lockUser(tx, caregiverId);
    await ensureAssignment(tx, caregiverId, clientId);
    const offerInvalid =
      ("caregiverId" in present && value.caregiverId !== undefined && value.caregiverId !== current.caregiverId) ||
      ("clientId" in present && value.clientId !== undefined && value.clientId !== current.clientId) ||
      ("scheduledDate" in present &&
        value.scheduledDate !== undefined &&
        value.scheduledDate !== nullableDate(current.scheduledDate)) ||
      ("startTime" in present &&
        value.startTime !== undefined &&
        formatClock(value.startTime) !== formatClock(current.startTime)) ||
      ("endTime" in present &&
        value.endTime !== undefined &&
        formatClock(value.endTime) !== formatClock(current.endTime)) ||
      ("appointmentStatus" in present &&
        value.appointmentStatus !== undefined &&
        value.appointmentStatus !== current.appointmentStatus &&
        value.appointmentStatus !== "scheduled");
    if (offerInvalid) {
      await closeOpenCoverageForAppointments(
        tx,
        [appointmentId],
        value.appointmentStatus === "cancelled" ? "cancelled" : "changed",
      );
    }
    const data: Prisma.AppointmentUpdateInput = {};
    if ("description" in present && value.description !== undefined) data.description = value.description;
    if ("instructions" in present && value.instructions !== undefined) data.instructions = value.instructions;
    if ("notes" in present && value.notes !== undefined) data.notes = value.notes;
    if ("locationStreet" in present && value.locationStreet !== undefined) data.locationStreet = value.locationStreet;
    if ("locationCity" in present && value.locationCity !== undefined) data.locationCity = value.locationCity;
    if ("locationState" in present && value.locationState !== undefined) data.locationState = value.locationState;
    if ("locationZipCode" in present && value.locationZipCode !== undefined) data.locationZipCode = value.locationZipCode;
    if ("locationGateCode" in present && value.locationGateCode !== undefined) data.locationGateCode = value.locationGateCode;
    if ("locationNavigation" in present && value.locationNavigation !== undefined) {
      data.locationNavigation = value.locationNavigation;
    }
    if ("appointmentType" in present && value.appointmentType !== undefined) {
      data.appointmentType = normalizeType(value.appointmentType);
    }
    if ("clientId" in present && value.clientId) {
      data.client = { connect: { id: value.clientId } };
      const plan = await tx.carePlan.findFirst({ where: { clientId: value.clientId }, orderBy: { id: "asc" } });
      data.carePlan = plan ? { connect: { id: plan.id } } : { disconnect: true };
    }
    if ("caregiverId" in present && value.caregiverId) {
      data.caregiver = { connect: { id: value.caregiverId } };
    }
    const scheduledDate =
      "scheduledDate" in present && value.scheduledDate
        ? value.scheduledDate
        : nullableDate(current.scheduledDate);
    if ("scheduledDate" in present && value.scheduledDate) {
      data.scheduledDate = parseIsoDate(value.scheduledDate);
      data.endDate = parseIsoDate(value.scheduledDate);
    }
    const startTime = "startTime" in present && value.startTime ? value.startTime : current.startTime;
    const endTime = "endTime" in present && value.endTime ? value.endTime : current.endTime;
    if ("startTime" in present && value.startTime) data.startTime = value.startTime;
    if ("endTime" in present && value.endTime) data.endTime = value.endTime;
    if ("startTime" in present || "endTime" in present) {
      const start = clockMinutes(startTime);
      const end = clockMinutes(endTime);
      if (start === null || end === null || end <= start) {
        throw validation("End time must be after start time", {
          endTime: ["End time must be after start time"],
        });
      }
      data.durationMinutes = end - start;
    }
    const nextStatus =
      "appointmentStatus" in present && value.appointmentStatus
        ? value.appointmentStatus
        : current.appointmentStatus;
    if ("appointmentStatus" in present && value.appointmentStatus) {
      data.appointmentStatus = value.appointmentStatus;
    }
    const scheduleChanged =
      "caregiverId" in present || "scheduledDate" in present || "startTime" in present || "endTime" in present;
    if (scheduleChanged && nextStatus !== "cancelled" && scheduledDate) {
      await assertSchedulable(tx, caregiverId, [{ date: scheduledDate, startTime, endTime }], {
        ignoreIds: [appointmentId],
        acknowledgeWarnings: value.acknowledgeWarnings,
      });
    }
    if (current.seriesId && Object.keys(present).some((key) => key !== "acknowledgeWarnings")) {
      data.isException = true;
    }
    await tx.appointment.update({ where: { id: appointmentId }, data });
    if (nextServiceIds !== undefined) {
      await tx.appointmentService.deleteMany({ where: { appointmentId } });
      if (nextServiceIds.length > 0) {
        await tx.appointmentService.createMany({
          data: nextServiceIds.map((serviceId) => ({ appointmentId, serviceId })),
        });
      }
    }
    if (value.appointmentStatus === "cancelled") {
      await tx.appointmentDailyVisit.updateMany({
        where: { appointmentId },
        data: { dailyVisitStatus: "cancelled", completed: false, active: false },
      });
    }
  });
  return getAppointment("", appointmentId, today, "any");
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  assertUuid(appointmentId);
  await deliveringTransaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, seriesId: true, seriesDate: true, seriesSlot: true },
    });
    if (!appointment) {
      throw notFound();
    }
    await closeOpenCoverageForAppointments(tx, [appointmentId], "deleted");
    if (appointment.seriesId && appointment.seriesDate && appointment.seriesSlot !== null) {
      await tx.visitSeriesExclusion.upsert({
        where: {
          seriesId_seriesDate_seriesSlot: {
            seriesId: appointment.seriesId,
            seriesDate: appointment.seriesDate,
            seriesSlot: appointment.seriesSlot,
          },
        },
        create: {
          seriesId: appointment.seriesId,
          seriesDate: appointment.seriesDate,
          seriesSlot: appointment.seriesSlot,
        },
        update: {},
      });
    }
    await tx.carePlanCheckIn.deleteMany({ where: { appointmentId } });
    await tx.appointmentDailyVisit.deleteMany({ where: { appointmentId } });
    await tx.appointmentService.deleteMany({ where: { appointmentId } });
    await tx.appointment.delete({ where: { id: appointmentId } });
  });
}
