import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { assertUuid } from "../domain/ids";
import { now } from "../lib/clock";
import { eachDate, formatClock, nullableDate } from "../lib/dates";
import { conflict, notFound, scheduleConflicts } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockAppointment, lockRelease, lockUser } from "../lib/rowLock";
import { deliveringTransaction, queueNotificationPushes } from "./push.service";
import { loadAppointmentGraph, serializeLoadedAppointments } from "./records";
import { findConflicts } from "./scheduleRules";

type Tx = PrismaTypes.TransactionClient;

export type CoverageCloseReason = "withdrawn" | "cancelled" | "changed" | "deleted" | "started";

const STARTED = new Set(["completed", "in_progress", "ongoing"]);

const releaseUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
} satisfies Prisma.UserSelect;

interface VisitClock {
  scheduledDate: Date | null;
  endDate: Date | null;
  startTime: string;
  endTime: string;
}

interface Blocker {
  reason: CoverageCloseReason;
  message: string;
}

function personName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function visitPhrase(client: { firstName: string; lastName: string }, visit: VisitClock): string {
  const who = `${client.firstName} ${client.lastName}`.trim();
  const start = nullableDate(visit.scheduledDate);
  const end = nullableDate(visit.endDate);
  const clock = `${formatClock(visit.startTime)} to ${formatClock(visit.endTime)}`;
  if (!start) {
    return `${who} (${clock})`;
  }
  const day = end && end !== start ? `${start} to ${end}` : start;
  return `${who} on ${day}, ${clock}`;
}

function offerBlocker(
  visit: VisitClock & {
    appointmentStatus: string;
    dailyVisits: { checkInAt: Date | null; completed: boolean; dailyVisitStatus: string }[];
    checkInCount: number;
  },
  today: string,
): Blocker | null {
  if (visit.appointmentStatus === "cancelled") {
    return { reason: "cancelled", message: "A cancelled visit cannot be offered" };
  }
  if (visit.appointmentStatus === "completed") {
    return { reason: "changed", message: "A completed visit cannot be offered" };
  }
  if (visit.appointmentStatus !== "scheduled") {
    return { reason: "changed", message: "Only a scheduled visit can be offered" };
  }
  const start = nullableDate(visit.scheduledDate);
  const end = nullableDate(visit.endDate) ?? start;
  if (!start || !end) {
    return { reason: "changed", message: "This visit has no date" };
  }
  if (end < today) {
    return { reason: "changed", message: "This visit has already passed" };
  }
  const started =
    visit.checkInCount > 0 ||
    visit.dailyVisits.some(
      (day) => day.checkInAt !== null || day.completed || STARTED.has(day.dailyVisitStatus),
    );
  if (started) {
    return { reason: "started", message: "A visit that has already started cannot be offered" };
  }
  return null;
}

function noticeFor(reason: CoverageCloseReason, phrase: string, requesterName: string) {
  if (reason === "withdrawn") {
    return {
      type: "appointment_coverage_withdrawn",
      title: "Coverage request withdrawn",
      body: `${requesterName} will keep the visit with ${phrase}.`,
    };
  }
  if (reason === "cancelled") {
    return {
      type: "appointment_coverage_unavailable",
      title: "Visit no longer available",
      body: `The visit with ${phrase} was cancelled.`,
    };
  }
  if (reason === "started") {
    return {
      type: "appointment_coverage_unavailable",
      title: "Visit no longer available",
      body: `The visit with ${phrase} has started and is no longer available to cover.`,
    };
  }
  return {
    type: "appointment_coverage_unavailable",
    title: "Visit no longer available",
    body: `The visit with ${phrase} is no longer available to cover.`,
  };
}

function statusMessage(status: string): string {
  if (status === "accepted") {
    return "This visit has already been taken";
  }
  if (status === "withdrawn") {
    return "This coverage request was withdrawn";
  }
  return "This visit is no longer available";
}

function toPerson(user: { id: string; firstName: string; lastName: string; phone: string | null }) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? "",
  };
}

function toRelease(release: {
  id: string;
  appointmentId: string;
  status: string;
  reason: string;
  createdAt: Date;
  resolvedAt: Date | null;
  requestedBy: { id: string; firstName: string; lastName: string; phone: string | null };
  acceptedBy: { id: string; firstName: string; lastName: string; phone: string | null } | null;
}) {
  return {
    id: release.id,
    appointmentId: release.appointmentId,
    status: release.status,
    reason: release.reason,
    createdAt: release.createdAt.toISOString(),
    resolvedAt: release.resolvedAt ? release.resolvedAt.toISOString() : null,
    requestedBy: toPerson(release.requestedBy),
    acceptedBy: release.acceptedBy ? toPerson(release.acceptedBy) : null,
  };
}

function toNotification(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  releaseId: string | null;
  appointmentId: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    releaseId: row.releaseId,
    appointmentId: row.appointmentId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function queueRelease(tx: Tx, releaseId: string): Promise<void> {
  const rows = await tx.notification.findMany({ where: { releaseId }, select: { id: true } });
  queueNotificationPushes(rows.map((row) => row.id));
}

async function lockCaregivers(tx: Tx, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await lockUser(tx, id);
  }
}

async function assignClient(tx: Tx, caregiverId: string, clientId: string): Promise<void> {
  await tx.caregiverClientAssignment.upsert({
    where: { caregiverId_clientId: { caregiverId, clientId } },
    create: { id: randomUUID(), caregiverId, clientId },
    update: {},
  });
}

async function fullAppointment(appointmentId: string, today: string) {
  const appointment = await loadAppointmentGraph(appointmentId);
  if (!appointment) {
    throw notFound();
  }
  const [serialized] = await serializeLoadedAppointments([appointment], today);
  return serialized;
}

async function releaseWithPeople(id: string) {
  const release = await prisma.appointmentRelease.findUnique({
    where: { id },
    include: { requestedBy: { select: releaseUserSelect }, acceptedBy: { select: releaseUserSelect } },
  });
  if (!release) {
    throw notFound();
  }
  return release;
}

const offerInclude = {
  requestedBy: { select: releaseUserSelect },
  acceptedBy: { select: releaseUserSelect },
  appointment: {
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      dailyVisits: { select: { checkInAt: true, completed: true, dailyVisitStatus: true } },
      _count: { select: { checkIns: true } },
    },
  },
} satisfies Prisma.AppointmentReleaseInclude;

type OfferRow = Prisma.AppointmentReleaseGetPayload<{ include: typeof offerInclude }>;

function preview(row: OfferRow) {
  const visit = row.appointment;
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    requestedBy: toPerson(row.requestedBy),
    appointment: {
      id: visit.id,
      description: visit.description,
      scheduledDate: nullableDate(visit.scheduledDate),
      endDate: nullableDate(visit.endDate),
      startTime: formatClock(visit.startTime),
      endTime: formatClock(visit.endTime),
      appointmentType: visit.appointmentType,
      locationStreet: visit.locationStreet,
      locationCity: visit.locationCity,
      locationState: visit.locationState,
      locationZipCode: visit.locationZipCode,
      client: {
        id: visit.client.id,
        firstName: visit.client.firstName,
        lastName: visit.client.lastName,
      },
    },
  };
}

function rowBlocker(row: OfferRow, today: string): Blocker | null {
  if (row.appointment.caregiverId !== row.requestedById) {
    return { reason: "changed", message: "This visit is no longer available" };
  }
  return offerBlocker(
    {
      appointmentStatus: row.appointment.appointmentStatus,
      scheduledDate: row.appointment.scheduledDate,
      endDate: row.appointment.endDate,
      startTime: row.appointment.startTime,
      endTime: row.appointment.endTime,
      dailyVisits: row.appointment.dailyVisits,
      checkInCount: row.appointment._count.checkIns,
    },
    today,
  );
}

export async function closeOpenCoverageForAppointments(
  tx: Tx,
  appointmentIds: string[],
  reason: CoverageCloseReason,
  options: { skipRequester?: boolean } = {},
): Promise<void> {
  if (appointmentIds.length === 0) {
    return;
  }
  const releases = await tx.appointmentRelease.findMany({
    where: { appointmentId: { in: appointmentIds }, status: "open" },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
      appointment: {
        select: {
          scheduledDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          client: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  for (const release of releases) {
    const claimed = await tx.appointmentRelease.updateMany({
      where: { id: release.id, status: "open" },
      data: {
        status: reason === "withdrawn" ? "withdrawn" : "closed",
        resolvedAt: now(),
      },
    });
    if (claimed.count !== 1) {
      continue;
    }
    const phrase = visitPhrase(release.appointment.client, release.appointment);
    const notice = noticeFor(reason, phrase, personName(release.requestedBy));
    await tx.notification.updateMany({
      where: { releaseId: release.id },
      data: { type: notice.type, title: notice.title, body: notice.body, readAt: null },
    });
    if (!options.skipRequester) {
      await tx.notification.create({
        data: {
          id: randomUUID(),
          userId: release.requestedById,
          type: notice.type,
          title: "Coverage request closed",
          body: `Your coverage request for the visit with ${phrase} was closed.`,
          releaseId: release.id,
          appointmentId: release.appointmentId,
          createdAt: now(),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: release.requestedById,
        action: reason === "withdrawn" ? "appointment_coverage_withdrawn" : "appointment_coverage_closed",
        entityType: "appointment",
        entityId: release.appointmentId,
      },
    });
    await queueRelease(tx, release.id);
  }
}

async function reconcile(rows: OfferRow[], today: string): Promise<OfferRow[]> {
  const visible: OfferRow[] = [];
  const stale: { appointmentId: string; blocker: Blocker }[] = [];
  for (const row of rows) {
    const blocker = rowBlocker(row, today);
    if (blocker) {
      stale.push({ appointmentId: row.appointmentId, blocker });
    } else {
      visible.push(row);
    }
  }
  if (stale.length > 0) {
    await deliveringTransaction(async (tx) => {
      for (const item of stale) {
        await closeOpenCoverageForAppointments(tx, [item.appointmentId], item.blocker.reason, {
          skipRequester: item.blocker.reason === "started",
        });
      }
    });
  }
  return visible;
}

async function listOffers(where: Prisma.AppointmentReleaseWhereInput, today: string) {
  const rows = await prisma.appointmentRelease.findMany({
    where,
    include: offerInclude,
    orderBy: [{ appointment: { scheduledDate: "asc" } }, { appointment: { startTime: "asc" } }, { id: "asc" }],
  });
  const visible = await reconcile(rows, today);
  return visible.map(preview);
}

export async function listOpenCoverage(userId: string, today: string) {
  return listOffers({ status: "open", requestedById: { not: userId } }, today);
}

export async function listMyCoverage(userId: string, today: string) {
  return listOffers({ status: "open", requestedById: userId }, today);
}

async function coveragePayload(releaseId: string, today: string, notifiedCount?: number) {
  const release = await releaseWithPeople(releaseId);
  const appointment = await fullAppointment(release.appointmentId, today);
  return {
    ...(notifiedCount === undefined ? {} : { notifiedCount }),
    release: toRelease(release),
    appointment,
  };
}

export async function requestCoverage(userId: string, appointmentId: string, reason: string, today: string) {
  assertUuid(appointmentId);
  let releaseId = "";
  let notifiedCount = 0;
  try {
    const created = await deliveringTransaction(async (tx) => {
      await lockCaregivers(tx, [userId]);
      await lockAppointment(tx, appointmentId);
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          client: { select: { firstName: true, lastName: true } },
          caregiver: { select: { firstName: true, lastName: true } },
          dailyVisits: { select: { checkInAt: true, completed: true, dailyVisitStatus: true } },
          _count: { select: { checkIns: true } },
        },
      });
      if (!appointment || appointment.caregiverId !== userId) {
        throw notFound();
      }
      const blocker = offerBlocker(
        { ...appointment, checkInCount: appointment._count.checkIns },
        today,
      );
      if (blocker) {
        throw conflict(blocker.message);
      }
      const open = await tx.appointmentRelease.findFirst({
        where: { appointmentId, status: "open" },
        select: { id: true },
      });
      if (open) {
        throw conflict("This visit is already offered to other caregivers");
      }
      const id = randomUUID();
      const phrase = visitPhrase(appointment.client, appointment);
      const requesterName = personName(appointment.caregiver);
      await tx.appointmentRelease.create({
        data: {
          id,
          appointmentId,
          requestedById: userId,
          reason,
          status: "open",
          createdAt: now(),
        },
      });
      const others = await tx.user.findMany({
        where: { role: "CAREGIVER", status: "active", id: { not: userId } },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      if (others.length > 0) {
        await tx.notification.createMany({
          data: others.map((caregiver) => ({
            id: randomUUID(),
            userId: caregiver.id,
            type: "appointment_coverage_requested",
            title: "A visit needs coverage",
            body: `${requesterName} cannot take the visit with ${phrase}. Reason: ${reason}`,
            releaseId: id,
            appointmentId,
            createdAt: now(),
          })),
        });
      }
      await queueRelease(tx, id);
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorUserId: userId,
          action: "appointment_coverage_requested",
          entityType: "appointment",
          entityId: appointmentId,
        },
      });
      return { id, notifiedCount: others.length };
    });
    releaseId = created.id;
    notifiedCount = created.notifiedCount;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("This visit is already offered to other caregivers");
    }
    throw error;
  }
  return coveragePayload(releaseId, today, notifiedCount);
}

export async function withdrawCoverage(userId: string, appointmentId: string, today: string) {
  assertUuid(appointmentId);
  const releaseId = await deliveringTransaction(async (tx) => {
    await lockCaregivers(tx, [userId]);
    await lockAppointment(tx, appointmentId);
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, caregiverId: true },
    });
    if (!appointment || appointment.caregiverId !== userId) {
      throw notFound();
    }
    const open = await tx.appointmentRelease.findFirst({
      where: { appointmentId, status: "open", requestedById: userId },
      select: { id: true },
    });
    if (!open) {
      throw conflict("This visit is not offered to other caregivers");
    }
    await lockRelease(tx, open.id);
    await closeOpenCoverageForAppointments(tx, [appointmentId], "withdrawn", { skipRequester: true });
    return open.id;
  });
  return coveragePayload(releaseId, today);
}

export async function getCoverage(userId: string, releaseId: string, today: string) {
  assertUuid(releaseId);
  const release = await prisma.appointmentRelease.findUnique({
    where: { id: releaseId },
    include: offerInclude,
  });
  if (!release) {
    throw notFound();
  }
  if (release.status === "open") {
    const blocker = rowBlocker(release, today);
    if (blocker) {
      await deliveringTransaction(async (tx) => {
        await lockCaregivers(tx, [release.requestedById]);
        await lockAppointment(tx, release.appointmentId);
        await lockRelease(tx, release.id);
        await closeOpenCoverageForAppointments(tx, [release.appointmentId], blocker.reason, {
          skipRequester: blocker.reason === "started",
        });
      });
      throw conflict(blocker.message);
    }
    return coveragePayload(release.id, today);
  }
  if (release.requestedById === userId || release.acceptedById === userId) {
    return coveragePayload(release.id, today);
  }
  throw conflict(statusMessage(release.status));
}

export async function acceptCoverage(userId: string, releaseId: string, today: string) {
  assertUuid(releaseId);
  const existing = await prisma.appointmentRelease.findUnique({
    where: { id: releaseId },
    select: { id: true, appointmentId: true, requestedById: true, status: true },
  });
  if (!existing) {
    throw notFound();
  }
  const outcome = await deliveringTransaction(async (tx) => {
    await lockCaregivers(tx, [existing.requestedById, userId]);
    await lockAppointment(tx, existing.appointmentId);
    await lockRelease(tx, existing.id);
    const release = await tx.appointmentRelease.findUnique({ where: { id: existing.id } });
    if (!release) {
      throw notFound();
    }
    if (release.status !== "open") {
      throw conflict(statusMessage(release.status));
    }
    if (release.requestedById === userId) {
      throw conflict("You cannot accept your own visit");
    }
    const appointment = await tx.appointment.findUnique({
      where: { id: release.appointmentId },
      include: {
        client: { select: { firstName: true, lastName: true } },
        dailyVisits: { select: { checkInAt: true, completed: true, dailyVisitStatus: true } },
        _count: { select: { checkIns: true } },
      },
    });
    if (!appointment) {
      throw notFound();
    }
    if (appointment.caregiverId !== release.requestedById) {
      await closeOpenCoverageForAppointments(tx, [appointment.id], "changed");
      return { blocked: "This visit is no longer available" };
    }
    const blocker = offerBlocker({ ...appointment, checkInCount: appointment._count.checkIns }, today);
    if (blocker) {
      await closeOpenCoverageForAppointments(tx, [appointment.id], blocker.reason, {
        skipRequester: blocker.reason === "started",
      });
      return { blocked: blocker.message };
    }
    const start = nullableDate(appointment.scheduledDate);
    const end = nullableDate(appointment.endDate) ?? start;
    const occurrences = eachDate(start as string, end as string).map((date) => ({
      date,
      startTime: formatClock(appointment.startTime),
      endTime: formatClock(appointment.endTime),
    }));
    const conflicts = await findConflicts(tx, userId, occurrences, [appointment.id]);
    if (conflicts.length > 0) {
      throw scheduleConflicts(conflicts);
    }
    const accepter = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, role: true, status: true },
    });
    if (!accepter || accepter.role !== "CAREGIVER" || accepter.status !== "active") {
      throw notFound();
    }
    const claimed = await tx.appointmentRelease.updateMany({
      where: { id: release.id, status: "open" },
      data: { status: "accepted", acceptedById: userId, resolvedAt: now() },
    });
    if (claimed.count !== 1) {
      throw conflict("This visit has already been taken");
    }
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        caregiverId: userId,
        ...(appointment.seriesId ? { isException: true } : {}),
      },
    });
    await assignClient(tx, userId, appointment.clientId);
    const phrase = visitPhrase(appointment.client, appointment);
    const accepterName = personName(accepter);
    const assigned = await tx.notification.updateMany({
      where: { releaseId: release.id, userId },
      data: {
        type: "appointment_coverage_assigned",
        title: "You accepted a visit",
        body: `The visit with ${phrase} is now yours.`,
        readAt: null,
      },
    });
    if (assigned.count === 0) {
      await tx.notification.create({
        data: {
          id: randomUUID(),
          userId,
          type: "appointment_coverage_assigned",
          title: "You accepted a visit",
          body: `The visit with ${phrase} is now yours.`,
          releaseId: release.id,
          appointmentId: appointment.id,
          createdAt: now(),
        },
      });
    }
    await tx.notification.updateMany({
      where: { releaseId: release.id, userId: { not: userId } },
      data: {
        type: "appointment_coverage_taken",
        title: "Visit already covered",
        body: `The visit with ${phrase} has been taken.`,
        readAt: null,
      },
    });
    await tx.notification.create({
      data: {
        id: randomUUID(),
        userId: release.requestedById,
        type: "appointment_coverage_accepted",
        title: "Your visit was covered",
        body: `${accepterName} accepted the visit with ${phrase}.`,
        releaseId: release.id,
        appointmentId: appointment.id,
        createdAt: now(),
      },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: userId,
        action: "appointment_coverage_accepted",
        entityType: "appointment",
        entityId: appointment.id,
      },
    });
    await queueRelease(tx, release.id);
    return { blocked: null };
  });
  if (outcome.blocked) {
    throw conflict(outcome.blocked);
  }
  return coveragePayload(existing.id, today);
}

export async function listNotifications(userId: string, unreadOnly: boolean) {
  const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unreadCount,
    notifications: rows.map(toNotification),
  };
}

export async function markNotificationRead(userId: string, notificationId: string) {
  assertUuid(notificationId);
  const row = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!row || row.userId !== userId) {
    throw notFound();
  }
  if (row.readAt) {
    return toNotification(row);
  }
  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: now() },
  });
  return toNotification(updated);
}

export async function markAllNotificationsRead(userId: string) {
  const updated = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now() },
  });
  return { updatedCount: updated.count };
}
