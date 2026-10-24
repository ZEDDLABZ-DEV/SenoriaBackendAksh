import { randomUUID } from "node:crypto";
import type { CarePlan, Prisma } from "@prisma/client";
import { ITEM_TYPE_VALUES, parseItemType } from "../domain/enums";
import { assertUuid } from "../domain/ids";
import { dateInRange, formatClock, nullableDate, parseIsoDate } from "../lib/dates";
import { conflict, notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockAppointment, lockCarePlan } from "../lib/rowLock";
import type { CheckInBody } from "../validation/carePlans";
import { getAppointment } from "./appointment.service";
import { closeOpenCoverageForAppointments } from "./coverage.service";
import { deliveringTransaction } from "./push.service";
import { requireOwnedCarePlan } from "./scope";

type Tx = Prisma.TransactionClient;

const BLOCKED_VISIT = new Set(["cancelled", "canceled", "missed", "completed"]);

async function assertVisitCanBeCheckedIn(tx: Tx, appointmentId: string, date: string, today: string) {
  if (date > today) {
    throw validation("Check-in is not available before the visit date", {
      date: ["Check-in is not available before the visit date"],
    });
  }
  const serviceDate = parseIsoDate(date);
  const visit = await tx.appointmentDailyVisit.findUnique({
    where: { appointmentId_serviceDate: { appointmentId, serviceDate } },
  });
  if (visit && (visit.completed || visit.dailyVisitStatus === "completed")) {
    throw conflict("This visit is already completed");
  }
  if (visit && BLOCKED_VISIT.has(visit.dailyVisitStatus)) {
    throw conflict("This visit cannot be checked in");
  }
  const priorCheckIn = await tx.carePlanCheckIn.findFirst({
    where: { appointmentId, serviceDate },
    select: { id: true },
  });
  if (visit?.checkInAt || priorCheckIn) {
    throw conflict("This visit is already checked in");
  }
}

async function bindAppointment(
  tx: Tx,
  caregiverId: string,
  plan: CarePlan,
  body: CheckInBody,
  today: string,
) {
  if (body.appointmentId) {
    let appointmentId: string;
    try {
      appointmentId = assertUuid(body.appointmentId);
    } catch {
      throw validation("No appointment matches this check-in date", {
        appointmentId: ["appointmentId is not valid"],
      });
    }
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.caregiverId !== caregiverId) {
      throw notFound();
    }
    if (appointment.clientId !== plan.clientId) {
      throw validation("This care plan does not belong to the appointment's client", {
        appointmentId: ["appointmentId does not match this care plan"],
      });
    }
    return acceptAppointmentForCheckIn(tx, appointment, caregiverId, plan.clientId, body, today, false);
  }

  const match = await pickVisitForDate(tx, caregiverId, plan.clientId, body.date);
  return acceptAppointmentForCheckIn(tx, match, caregiverId, plan.clientId, body, today, true);
}

// A caregiver can have several visits with the same client on one day
// (for example 11:00 and 17:00). Without an appointmentId the earliest visit
// that is not yet checked in or closed is used.
async function pickVisitForDate(tx: Tx, caregiverId: string, clientId: string, date: string) {
  const candidates = await tx.appointment.findMany({
    where: {
      caregiverId,
      clientId,
      appointmentStatus: "scheduled",
      recordStatus: "active",
    },
  });
  const matches = candidates.filter((appointment) =>
    dateInRange(date, nullableDate(appointment.scheduledDate), nullableDate(appointment.endDate)),
  );
  if (matches.length === 0) {
    throw validation("No appointment matches this check-in date", {
      date: ["No scheduled appointment covers this date"],
    });
  }
  if (matches.length === 1) {
    return matches[0];
  }
  const ids = matches.map((appointment) => appointment.id);
  const serviceDate = parseIsoDate(date);
  const [visits, checkIns] = await Promise.all([
    tx.appointmentDailyVisit.findMany({ where: { appointmentId: { in: ids }, serviceDate } }),
    tx.carePlanCheckIn.findMany({ where: { appointmentId: { in: ids }, serviceDate }, select: { appointmentId: true } }),
  ]);
  const closed = new Set(checkIns.map((row) => row.appointmentId));
  for (const visit of visits) {
    if (visit.checkInAt || visit.completed || BLOCKED_VISIT.has(visit.dailyVisitStatus)) {
      closed.add(visit.appointmentId);
    }
  }
  const open = matches
    .filter((appointment) => !closed.has(appointment.id))
    .sort(
      (left, right) =>
        formatClock(left.startTime).localeCompare(formatClock(right.startTime)) || left.id.localeCompare(right.id),
    );
  if (open.length === 0) {
    throw validation("Every visit on this date is already checked in or closed", {
      appointmentId: ["Every visit on this date is already checked in or closed"],
    });
  }
  return open[0];
}

async function acceptAppointmentForCheckIn(
  tx: Tx,
  appointment: { id: string },
  caregiverId: string,
  clientId: string,
  body: CheckInBody,
  today: string,
  requireUniqueMatch: boolean,
) {
  await lockAppointment(tx, appointment.id);
  const fresh = await tx.appointment.findUnique({ where: { id: appointment.id } });
  if (!fresh || fresh.caregiverId !== caregiverId) {
    throw notFound();
  }
  if (fresh.clientId !== clientId) {
    throw validation("This care plan does not belong to the appointment's client", {
      appointmentId: ["appointmentId does not match this care plan"],
    });
  }
  if (fresh.appointmentStatus === "cancelled") {
    throw conflict("A cancelled visit cannot be checked in");
  }
  if (fresh.appointmentStatus === "completed") {
    throw conflict("A completed visit cannot be checked in");
  }
  if (requireUniqueMatch) {
    const match = await pickVisitForDate(tx, caregiverId, clientId, body.date);
    if (match.id !== fresh.id) {
      throw validation("No appointment matches this check-in date", {
        date: ["No scheduled appointment covers this date"],
      });
    }
  }
  if (fresh.appointmentStatus !== "scheduled" || fresh.recordStatus !== "active") {
    throw validation("No appointment matches this check-in date", {
      appointmentId: ["The appointment is not an active scheduled visit"],
    });
  }
  if (!dateInRange(body.date, nullableDate(fresh.scheduledDate), nullableDate(fresh.endDate))) {
    throw validation("Date is outside the appointment range", {
      date: ["Date is outside the appointment range"],
    });
  }
  await assertVisitCanBeCheckedIn(tx, fresh.id, body.date, today);
  return fresh;
}

export async function checkIn(caregiverId: string, carePlanId: string, body: CheckInBody, today: string) {
  const plan = await requireOwnedCarePlan(caregiverId, carePlanId);
  const appointmentId = await deliveringTransaction(async (tx) => {
    const appointment = await bindAppointment(tx, caregiverId, plan, body, today);
    const serviceDate = parseIsoDate(body.date);
    const checkedInAt = new Date(body.timestamp);
    const existing = await tx.appointmentDailyVisit.findUnique({
      where: { appointmentId_serviceDate: { appointmentId: appointment.id, serviceDate } },
    });
    if (!existing) {
      await tx.appointmentDailyVisit.create({
        data: {
          id: randomUUID(),
          appointmentId: appointment.id,
          serviceDate,
          dailyVisitStatus: "pending",
          completed: false,
          active: body.date === today,
          checkInAt: checkedInAt,
        },
      });
    } else {
      const updated = await tx.appointmentDailyVisit.updateMany({
        where: {
          id: existing.id,
          completed: false,
          checkInAt: null,
          dailyVisitStatus: { notIn: ["completed", "cancelled", "canceled", "missed"] },
        },
        data: {
          dailyVisitStatus: "pending",
          active: body.date === today,
          checkInAt: checkedInAt,
        },
      });
      if (updated.count !== 1) {
        throw conflict("This visit cannot be checked in");
      }
    }
    await tx.carePlanCheckIn.create({
      data: {
        id: randomUUID(),
        carePlanId: plan.id,
        appointmentId: appointment.id,
        caregiverId,
        checkedInAt,
        serviceDate,
        latitude: body.location?.latitude ?? null,
        longitude: body.location?.longitude ?? null,
      },
    });
    await closeOpenCoverageForAppointments(tx, [appointment.id], "started", { skipRequester: true });
    return appointment.id;
  });

  return getAppointment(caregiverId, appointmentId, today);
}

async function itemBelongs(tx: Tx, carePlanId: string, itemType: string, itemId: string): Promise<boolean> {
  try {
    assertUuid(itemId);
  } catch {
    return false;
  }
  switch (itemType) {
    case "task":
      return Boolean(await tx.careTask.findFirst({ where: { id: itemId, carePlanId }, select: { id: true } }));
    case "medication":
      return Boolean(
        await tx.careMedication.findFirst({ where: { id: itemId, carePlanId }, select: { id: true } }),
      );
    case "diet":
      return Boolean(
        await tx.careDietInstruction.findFirst({ where: { id: itemId, carePlanId }, select: { id: true } }),
      );
    case "hygiene":
      return Boolean(
        await tx.careHygieneInstruction.findFirst({ where: { id: itemId, carePlanId }, select: { id: true } }),
      );
    default:
      return false;
  }
}

export async function toggleCompletion(
  caregiverId: string,
  carePlanId: string,
  input: { itemType: string; itemId: string; date: string },
) {
  const plan = await requireOwnedCarePlan(caregiverId, carePlanId);
  if (!(ITEM_TYPE_VALUES as readonly string[]).includes(input.itemType)) {
    throw validation("Validation failed", {
      itemType: ["itemType must be task, medication, diet, or hygiene"],
    });
  }
  const itemType = parseItemType(input.itemType);

  return prisma.$transaction(async (tx) => {
    await lockCarePlan(tx, plan.id);
    if (!(await itemBelongs(tx, plan.id, itemType, input.itemId))) {
      throw validation("Validation failed", {
        itemId: ["The item does not belong to this care plan"],
      });
    }
    const serviceDate = parseIsoDate(input.date);
    const checkInRow = await tx.carePlanCheckIn.findFirst({
      where: {
        carePlanId: plan.id,
        caregiverId,
        serviceDate,
      },
    });
    if (!checkInRow) {
      throw validation("Check in before updating the checklist", {
        date: ["A check-in is required for this date"],
      });
    }

    const existing = await tx.careItemCompletion.findUnique({
      where: {
        itemType_itemId_serviceDate: {
          itemType,
          itemId: input.itemId,
          serviceDate,
        },
      },
    });
    if (existing && existing.carePlanId !== plan.id) {
      throw validation("Validation failed", {
        itemId: ["The item does not belong to this care plan"],
      });
    }
    if (!existing) {
      await tx.careItemCompletion.create({
        data: {
          id: randomUUID(),
          carePlanId: plan.id,
          itemType,
          itemId: input.itemId,
          serviceDate,
          completed: true,
          caregiverId,
        },
      });
      return true;
    }
    const completed = !existing.completed;
    const updated = await tx.careItemCompletion.updateMany({
      where: { id: existing.id, carePlanId: plan.id, completed: existing.completed },
      data: { completed, caregiverId },
    });
    if (updated.count !== 1) {
      const fresh = await tx.careItemCompletion.findUnique({
        where: {
          itemType_itemId_serviceDate: {
            itemType,
            itemId: input.itemId,
            serviceDate,
          },
        },
      });
      if (!fresh || fresh.carePlanId !== plan.id) {
        throw validation("Validation failed", {
          itemId: ["The item does not belong to this care plan"],
        });
      }
      return fresh.completed;
    }
    return completed;
  });
}

const planInclude = {
  goals: true,
  tasks: true,
  medications: true,
  diet: true,
  hygiene: true,
} satisfies Prisma.CarePlanInclude;

function serializePlan(plan: Prisma.CarePlanGetPayload<{ include: typeof planInclude }>) {
  return {
    id: plan.id,
    clientId: plan.clientId,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    notes: plan.notes,
    startDate: nullableDate(plan.startDate),
    endDate: nullableDate(plan.endDate),
    goals: [...plan.goals].sort((left, right) => left.sortOrder - right.sortOrder).map((goal) => goal.text),
    tasks: [...plan.tasks]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((task) => ({
        id: task.id,
        carePlanId: task.carePlanId,
        name: task.name,
        frequency: task.frequency,
        description: task.description,
      })),
    medications: [...plan.medications]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((medication) => ({
        id: medication.id,
        carePlanId: medication.carePlanId,
        medicationName: medication.medicationName,
        dosage: medication.dosage,
        schedule: medication.schedule,
        description: medication.description,
      })),
    dietInstructions: [...plan.diet]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((diet) => ({
        id: diet.id,
        carePlanId: diet.carePlanId,
        meal: diet.meal,
        restrictions: diet.restrictions,
        description: diet.description,
      })),
    hygieneInstructions: [...plan.hygiene]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((hygiene) => ({
        id: hygiene.id,
        carePlanId: hygiene.carePlanId,
        activity: hygiene.activity,
        frequency: hygiene.frequency,
        description: hygiene.description,
      })),
  };
}

async function loadPlan(id: string) {
  assertUuid(id);
  const plan = await prisma.carePlan.findUnique({ where: { id }, include: planInclude });
  if (!plan) {
    throw notFound();
  }
  return plan;
}

export async function createCarePlan(input: {
  clientId: string;
  name: string;
  description: string;
  goals: string[];
  status: string;
  startDate?: string;
  endDate?: string;
}) {
  try {
    assertUuid(input.clientId);
  } catch {
    throw validation("clientId is not valid", { clientId: ["clientId is not valid"] });
  }
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
  if (!client) {
    throw validation("Client was not found", { clientId: ["Client was not found"] });
  }
  const existing = await prisma.carePlan.count({ where: { clientId: input.clientId } });
  if (existing > 0) {
    throw validation("This client already has a care plan", {
      clientId: ["This client already has a care plan"],
    });
  }
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.carePlan.create({
      data: {
        id,
        clientId: input.clientId,
        name: input.name,
        description: input.description,
        status: input.status,
        notes: "",
        startDate: input.startDate ? parseIsoDate(input.startDate) : null,
        endDate: input.endDate ? parseIsoDate(input.endDate) : null,
      },
    });
    for (const [index, text] of input.goals.entries()) {
      await tx.carePlanGoal.create({
        data: { id: randomUUID(), carePlanId: id, text, sortOrder: index },
      });
    }
  });
  return serializePlan(await loadPlan(id));
}

export async function updateCarePlan(
  carePlanId: string,
  present: Record<string, unknown>,
  value: {
    name?: string;
    description?: string;
    goals?: string[];
    status?: string;
    startDate?: string;
    endDate?: string;
  },
) {
  await loadPlan(carePlanId);
  await prisma.$transaction(async (tx) => {
    await lockCarePlan(tx, carePlanId);
    const data: Prisma.CarePlanUpdateInput = {};
    if ("name" in present && value.name !== undefined) {
      if (!value.name.trim()) {
        throw validation("name is required", { name: ["name is required"] });
      }
      data.name = value.name.trim();
    }
    if ("description" in present && value.description !== undefined) data.description = value.description;
    if ("status" in present && value.status !== undefined) data.status = value.status;
    if ("startDate" in present && value.startDate) data.startDate = parseIsoDate(value.startDate);
    if ("endDate" in present && value.endDate) data.endDate = parseIsoDate(value.endDate);
    await tx.carePlan.update({ where: { id: carePlanId }, data });
    if ("goals" in present) {
      await tx.carePlanGoal.deleteMany({ where: { carePlanId } });
      const goals = (value.goals ?? []).map((goal) => goal.trim()).filter((goal) => goal.length > 0);
      for (const [index, text] of goals.entries()) {
        await tx.carePlanGoal.create({
          data: { id: randomUUID(), carePlanId, text, sortOrder: index },
        });
      }
    }
  });
  return serializePlan(await loadPlan(carePlanId));
}

export async function deleteCarePlan(carePlanId: string): Promise<void> {
  await loadPlan(carePlanId);
  await prisma.$transaction(async (tx) => {
    await tx.carePlanCheckIn.deleteMany({ where: { carePlanId } });
    await tx.careItemCompletion.deleteMany({ where: { carePlanId } });
    await tx.carePlanGoal.deleteMany({ where: { carePlanId } });
    await tx.careTask.deleteMany({ where: { carePlanId } });
    await tx.careMedication.deleteMany({ where: { carePlanId } });
    await tx.careDietInstruction.deleteMany({ where: { carePlanId } });
    await tx.careHygieneInstruction.deleteMany({ where: { carePlanId } });
    await tx.carePlan.delete({ where: { id: carePlanId } });
  });
}

async function nextSort(tx: Tx, carePlanId: string, kind: "task" | "medication" | "diet" | "hygiene") {
  const rows =
    kind === "task"
      ? await tx.careTask.findMany({ where: { carePlanId }, select: { sortOrder: true } })
      : kind === "medication"
        ? await tx.careMedication.findMany({ where: { carePlanId }, select: { sortOrder: true } })
        : kind === "diet"
          ? await tx.careDietInstruction.findMany({ where: { carePlanId }, select: { sortOrder: true } })
          : await tx.careHygieneInstruction.findMany({ where: { carePlanId }, select: { sortOrder: true } });
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

export async function createTask(carePlanId: string, input: { name: string; frequency: string; description: string }) {
  await loadPlan(carePlanId);
  const task = await prisma.$transaction(async (tx) => {
    const sortOrder = await nextSort(tx, carePlanId, "task");
    return tx.careTask.create({
      data: { id: randomUUID(), carePlanId, ...input, sortOrder },
    });
  });
  return { id: task.id, carePlanId, name: task.name, frequency: task.frequency, description: task.description };
}

export async function updateTask(
  carePlanId: string,
  taskId: string,
  present: Record<string, unknown>,
  value: { name?: string; frequency?: string; description?: string },
) {
  assertUuid(taskId);
  const existing = await prisma.careTask.findFirst({ where: { id: taskId, carePlanId } });
  if (!existing) throw notFound();
  const data: Prisma.CareTaskUpdateInput = {};
  if ("name" in present && value.name !== undefined) data.name = value.name;
  if ("frequency" in present && value.frequency !== undefined) data.frequency = value.frequency;
  if ("description" in present && value.description !== undefined) data.description = value.description;
  const task = await prisma.careTask.update({ where: { id: taskId }, data });
  return { id: task.id, carePlanId, name: task.name, frequency: task.frequency, description: task.description };
}

export async function deleteTask(carePlanId: string, taskId: string): Promise<void> {
  assertUuid(taskId);
  const existing = await prisma.careTask.findFirst({ where: { id: taskId, carePlanId } });
  if (!existing) throw notFound();
  await prisma.careItemCompletion.deleteMany({ where: { itemType: "task", itemId: taskId } });
  await prisma.careTask.delete({ where: { id: taskId } });
}

export async function createMedication(
  carePlanId: string,
  input: { medicationName: string; dosage: string; schedule: string; description: string },
) {
  await loadPlan(carePlanId);
  const medication = await prisma.$transaction(async (tx) => {
    const sortOrder = await nextSort(tx, carePlanId, "medication");
    return tx.careMedication.create({ data: { id: randomUUID(), carePlanId, ...input, sortOrder } });
  });
  return {
    id: medication.id,
    carePlanId,
    medicationName: medication.medicationName,
    dosage: medication.dosage,
    schedule: medication.schedule,
    description: medication.description,
  };
}

export async function updateMedication(
  carePlanId: string,
  medicationId: string,
  present: Record<string, unknown>,
  value: { medicationName?: string; dosage?: string; schedule?: string; description?: string },
) {
  assertUuid(medicationId);
  const existing = await prisma.careMedication.findFirst({ where: { id: medicationId, carePlanId } });
  if (!existing) throw notFound();
  const data: Prisma.CareMedicationUpdateInput = {};
  if ("medicationName" in present && value.medicationName !== undefined) data.medicationName = value.medicationName;
  if ("dosage" in present && value.dosage !== undefined) data.dosage = value.dosage;
  if ("schedule" in present && value.schedule !== undefined) data.schedule = value.schedule;
  if ("description" in present && value.description !== undefined) data.description = value.description;
  const medication = await prisma.careMedication.update({ where: { id: medicationId }, data });
  return {
    id: medication.id,
    carePlanId,
    medicationName: medication.medicationName,
    dosage: medication.dosage,
    schedule: medication.schedule,
    description: medication.description,
  };
}

export async function deleteMedication(carePlanId: string, medicationId: string): Promise<void> {
  assertUuid(medicationId);
  const existing = await prisma.careMedication.findFirst({ where: { id: medicationId, carePlanId } });
  if (!existing) throw notFound();
  await prisma.careItemCompletion.deleteMany({ where: { itemType: "medication", itemId: medicationId } });
  await prisma.careMedication.delete({ where: { id: medicationId } });
}

export async function createDiet(
  carePlanId: string,
  input: { meal: string; restrictions: string; description: string },
) {
  await loadPlan(carePlanId);
  const diet = await prisma.$transaction(async (tx) => {
    const sortOrder = await nextSort(tx, carePlanId, "diet");
    return tx.careDietInstruction.create({ data: { id: randomUUID(), carePlanId, ...input, sortOrder } });
  });
  return {
    id: diet.id,
    carePlanId,
    meal: diet.meal,
    restrictions: diet.restrictions,
    description: diet.description,
  };
}

export async function updateDiet(
  carePlanId: string,
  dietId: string,
  present: Record<string, unknown>,
  value: { meal?: string; restrictions?: string; description?: string },
) {
  assertUuid(dietId);
  const existing = await prisma.careDietInstruction.findFirst({ where: { id: dietId, carePlanId } });
  if (!existing) throw notFound();
  const data: Prisma.CareDietInstructionUpdateInput = {};
  if ("meal" in present && value.meal !== undefined) data.meal = value.meal;
  if ("restrictions" in present && value.restrictions !== undefined) data.restrictions = value.restrictions;
  if ("description" in present && value.description !== undefined) data.description = value.description;
  const diet = await prisma.careDietInstruction.update({ where: { id: dietId }, data });
  return { id: diet.id, carePlanId, meal: diet.meal, restrictions: diet.restrictions, description: diet.description };
}

export async function deleteDiet(carePlanId: string, dietId: string): Promise<void> {
  assertUuid(dietId);
  const existing = await prisma.careDietInstruction.findFirst({ where: { id: dietId, carePlanId } });
  if (!existing) throw notFound();
  await prisma.careItemCompletion.deleteMany({ where: { itemType: "diet", itemId: dietId } });
  await prisma.careDietInstruction.delete({ where: { id: dietId } });
}

export async function createHygiene(
  carePlanId: string,
  input: { activity: string; frequency: string; description: string },
) {
  await loadPlan(carePlanId);
  const hygiene = await prisma.$transaction(async (tx) => {
    const sortOrder = await nextSort(tx, carePlanId, "hygiene");
    return tx.careHygieneInstruction.create({ data: { id: randomUUID(), carePlanId, ...input, sortOrder } });
  });
  return {
    id: hygiene.id,
    carePlanId,
    activity: hygiene.activity,
    frequency: hygiene.frequency,
    description: hygiene.description,
  };
}

export async function updateHygiene(
  carePlanId: string,
  hygieneId: string,
  present: Record<string, unknown>,
  value: { activity?: string; frequency?: string; description?: string },
) {
  assertUuid(hygieneId);
  const existing = await prisma.careHygieneInstruction.findFirst({ where: { id: hygieneId, carePlanId } });
  if (!existing) throw notFound();
  const data: Prisma.CareHygieneInstructionUpdateInput = {};
  if ("activity" in present && value.activity !== undefined) data.activity = value.activity;
  if ("frequency" in present && value.frequency !== undefined) data.frequency = value.frequency;
  if ("description" in present && value.description !== undefined) data.description = value.description;
  const hygiene = await prisma.careHygieneInstruction.update({ where: { id: hygieneId }, data });
  return {
    id: hygiene.id,
    carePlanId,
    activity: hygiene.activity,
    frequency: hygiene.frequency,
    description: hygiene.description,
  };
}

export async function deleteHygiene(carePlanId: string, hygieneId: string): Promise<void> {
  assertUuid(hygieneId);
  const existing = await prisma.careHygieneInstruction.findFirst({ where: { id: hygieneId, carePlanId } });
  if (!existing) throw notFound();
  await prisma.careItemCompletion.deleteMany({ where: { itemType: "hygiene", itemId: hygieneId } });
  await prisma.careHygieneInstruction.delete({ where: { id: hygieneId } });
}
