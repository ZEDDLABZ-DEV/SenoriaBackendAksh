import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { now } from "../lib/clock";
import { dateInRange, eachDate, formatDate, nullableDate, parseIsoDate } from "../lib/dates";
import { conflict, notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockAppointment } from "../lib/rowLock";
import { assertUuid } from "../domain/ids";
import { appointmentGraphInclude, loadAppointmentGraph, serializeLoadedAppointments } from "./records";
import { closeOpenCoverageForAppointments } from "./coverage.service";
import { deliveringTransaction } from "./push.service";
import { requireOwnedAppointment, requireSelf } from "./scope";

type Tx = Prisma.TransactionClient;

export async function listAppointments(userId: string, caregiverId: string, today: string) {
  requireSelf(userId, caregiverId);
  const appointments = await prisma.appointment.findMany({
    where: { caregiverId: userId },
    include: appointmentGraphInclude,
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });
  return serializeLoadedAppointments(appointments, today);
}

export async function getAppointment(
  userId: string,
  appointmentId: string,
  today: string,
  scope: "owner" | "any" = "owner",
) {
  if (scope === "owner") {
    await requireOwnedAppointment(userId, appointmentId);
  } else {
    assertUuid(appointmentId);
  }
  const appointment = await loadAppointmentGraph(appointmentId);
  if (!appointment || (scope === "owner" && appointment.caregiverId !== userId)) {
    throw notFound();
  }
  const [serialized] = await serializeLoadedAppointments([appointment], today);
  return serialized;
}

async function checklistIsIncomplete(tx: Tx, clientId: string, date: string): Promise<boolean> {
  const plans = await tx.carePlan.findMany({
    where: { clientId },
    include: { tasks: true, medications: true, diet: true, hygiene: true },
  });
  const items = plans.flatMap((plan) => [
    ...plan.tasks.map((item) => ({ type: "task", id: item.id })),
    ...plan.medications.map((item) => ({ type: "medication", id: item.id })),
    ...plan.diet.map((item) => ({ type: "diet", id: item.id })),
    ...plan.hygiene.map((item) => ({ type: "hygiene", id: item.id })),
  ]);
  if (items.length === 0) {
    return false;
  }
  const done = await tx.careItemCompletion.findMany({
    where: {
      serviceDate: parseIsoDate(date),
      completed: true,
      OR: items.map((item) => ({ itemType: item.type, itemId: item.id })),
    },
  });
  const doneKeys = new Set(done.map((row) => `${row.itemType}:${row.itemId}`));
  return items.some((item) => !doneKeys.has(`${item.type}:${item.id}`));
}

function visitIsCompleted(visit: { completed: boolean; dailyVisitStatus: string }): boolean {
  return visit.completed || visit.dailyVisitStatus === "completed";
}

export async function completeDay(userId: string, appointmentId: string, date: string, today: string) {
  await requireOwnedAppointment(userId, appointmentId);
  const serviceDate = parseIsoDate(date);

  await deliveringTransaction(async (tx) => {
    await lockAppointment(tx, appointmentId);
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.caregiverId !== userId) {
      throw notFound();
    }
    if (appointment.appointmentStatus === "cancelled") {
      throw conflict("A cancelled visit cannot be completed");
    }

    const start = nullableDate(appointment.scheduledDate);
    const end = nullableDate(appointment.endDate) ?? start;
    if (!start || !end || !dateInRange(date, start, end)) {
      throw validation("Date is outside the appointment range", {
        date: ["Date is outside the appointment range"],
      });
    }
    if (date > today) {
      throw validation("This date is still in the future", {
        date: ["This date is still in the future"],
      });
    }

    const existing = await tx.appointmentDailyVisit.findUnique({
      where: { appointmentId_serviceDate: { appointmentId, serviceDate } },
    });
    if (existing && visitIsCompleted(existing)) {
      await closeOpenCoverageForAppointments(tx, [appointmentId], "changed", { skipRequester: true });
      return;
    }
    if (appointment.appointmentStatus === "completed") {
      if (!existing) {
        await tx.appointmentDailyVisit.create({
          data: {
            id: randomUUID(),
            appointmentId,
            serviceDate,
            dailyVisitStatus: "completed",
            completed: true,
            active: false,
            checkOutAt: now(),
          },
        });
      } else {
        await tx.appointmentDailyVisit.updateMany({
          where: {
            id: existing.id,
            completed: false,
            dailyVisitStatus: { not: "completed" },
          },
          data: {
            dailyVisitStatus: "completed",
            completed: true,
            active: false,
          },
        });
      }
      await closeOpenCoverageForAppointments(tx, [appointmentId], "changed", { skipRequester: true });
      return;
    }

    if (await checklistIsIncomplete(tx, appointment.clientId, date)) {
      throw validation("Complete every care plan item for this date before marking the visit complete", {
        date: ["Complete every care plan item for this date before marking the visit complete"],
      });
    }

    if (!existing) {
      await tx.appointmentDailyVisit.create({
        data: {
          id: randomUUID(),
          appointmentId,
          serviceDate,
          dailyVisitStatus: "completed",
          completed: true,
          active: false,
          checkOutAt: now(),
        },
      });
    } else {
      const updated = await tx.appointmentDailyVisit.updateMany({
        where: {
          id: existing.id,
          completed: false,
          dailyVisitStatus: { not: "completed" },
        },
        data: {
          dailyVisitStatus: "completed",
          completed: true,
          active: false,
          checkOutAt: existing.checkOutAt ?? now(),
        },
      });
      if (updated.count !== 1) {
        await closeOpenCoverageForAppointments(tx, [appointmentId], "changed", { skipRequester: true });
        return;
      }
    }

    const completedRows = await tx.appointmentDailyVisit.findMany({
      where: { appointmentId, completed: true },
    });
    const done = new Set(completedRows.map((row) => formatDate(row.serviceDate)));
    if (eachDate(start, end).every((day) => done.has(day))) {
      const promoted = await tx.appointment.updateMany({
        where: { id: appointmentId, appointmentStatus: "scheduled" },
        data: { appointmentStatus: "completed" },
      });
      if (promoted.count !== 1) {
        throw conflict("This visit cannot be completed");
      }
    }
    await closeOpenCoverageForAppointments(tx, [appointmentId], "changed", { skipRequester: true });
  });

  return {
    appointmentId,
    date,
    completed: true as const,
  };
}

export async function cancelAppointment(
  userId: string,
  appointmentId: string,
  cancellationReason: string | undefined,
  today: string,
) {
  await requireOwnedAppointment(userId, appointmentId);

  await deliveringTransaction(async (tx) => {
    await lockAppointment(tx, appointmentId);
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.caregiverId !== userId) {
      throw notFound();
    }
    if (appointment.appointmentStatus === "cancelled") {
      throw conflict("This appointment is already cancelled");
    }
    if (appointment.appointmentStatus === "completed") {
      throw conflict("A completed appointment cannot be cancelled");
    }

    const visits = await tx.appointmentDailyVisit.findMany({ where: { appointmentId } });
    if (visits.some((visit) => visitIsCompleted(visit))) {
      throw conflict("An appointment with a completed visit cannot be cancelled");
    }
    const checkedIn =
      visits.some((visit) => visit.checkInAt !== null) ||
      (await tx.carePlanCheckIn.count({ where: { appointmentId } })) > 0;
    if (checkedIn) {
      throw conflict("A checked-in appointment cannot be cancelled");
    }
    if (appointment.appointmentStatus !== "scheduled") {
      throw conflict("Only a scheduled appointment can be cancelled");
    }

    await closeOpenCoverageForAppointments(tx, [appointmentId], "cancelled", { skipRequester: true });
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        appointmentStatus: "cancelled",
        ...(cancellationReason !== undefined ? { cancellationReason } : {}),
      },
    });
    await tx.appointmentDailyVisit.updateMany({
      where: { appointmentId },
      data: {
        dailyVisitStatus: "cancelled",
        completed: false,
        active: false,
        ...(cancellationReason !== undefined ? { cancellationReason } : {}),
      },
    });
  });

  return getAppointment(userId, appointmentId, today);
}
