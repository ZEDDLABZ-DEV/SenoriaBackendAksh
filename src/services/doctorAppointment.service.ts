import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assertUuid } from "../domain/ids";
import { clockMinutes, parseIsoDate } from "../lib/dates";
import { notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { serializeDoctorAppointment } from "../serializers/doctorAppointment";
import type { DoctorListQuery } from "../validation/doctorAppointments";
import { pageMeta } from "../validation/common";
import { requireClient, requireOwnedClient } from "./scope";

const appointmentInclude = {
  client: { select: { firstName: true, lastName: true } },
  type: { select: { name: true } },
} satisfies Prisma.DoctorAppointmentInclude;

function assertTimes(startTime: string, endTime: string): void {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === null || end === null || end <= start) {
    throw validation("End time must be after start time", {
      endTime: ["End time must be after start time"],
    });
  }
}

async function requireType(typeId: string) {
  try {
    assertUuid(typeId);
  } catch {
    throw validation("typeId is not valid", { typeId: ["typeId is not valid"] });
  }
  const type = await prisma.doctorAppointmentType.findUnique({ where: { id: typeId } });
  if (!type) {
    throw validation("Appointment type was not found", { typeId: ["Appointment type was not found"] });
  }
  return type;
}

async function requireClientRow(clientId: string) {
  try {
    assertUuid(clientId);
  } catch {
    throw validation("clientId is not valid", { clientId: ["clientId is not valid"] });
  }
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw validation("Client was not found", { clientId: ["Client was not found"] });
  }
  return client;
}

async function loadAppointment(id: string) {
  return prisma.doctorAppointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });
}

export async function listDoctorAppointmentTypes() {
  const rows = await prisma.doctorAppointmentType.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createDoctorAppointmentType(name: string) {
  const existing = await prisma.doctorAppointmentType.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    throw validation("That appointment type already exists", { name: ["That appointment type already exists"] });
  }
  const created = await prisma.doctorAppointmentType.create({
    data: { id: randomUUID(), name },
  });
  return { id: created.id, name: created.name };
}

export async function updateDoctorAppointmentType(id: string, name: string) {
  assertUuid(id);
  const current = await prisma.doctorAppointmentType.findUnique({ where: { id } });
  if (!current) {
    throw notFound();
  }
  const existing = await prisma.doctorAppointmentType.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, NOT: { id } },
  });
  if (existing) {
    throw validation("That appointment type already exists", { name: ["That appointment type already exists"] });
  }
  const updated = await prisma.doctorAppointmentType.update({ where: { id }, data: { name } });
  return { id: updated.id, name: updated.name };
}

export async function deleteDoctorAppointmentType(id: string): Promise<void> {
  assertUuid(id);
  const current = await prisma.doctorAppointmentType.findUnique({ where: { id } });
  if (!current) {
    throw notFound();
  }
  const inUse = await prisma.doctorAppointment.count({ where: { typeId: id } });
  if (inUse > 0) {
    throw validation("That appointment type is used by a doctor's appointment", {
      name: ["That appointment type is used by a doctor's appointment"],
    });
  }
  await prisma.doctorAppointmentType.delete({ where: { id } });
}

export async function listDoctorAppointments(query: DoctorListQuery) {
  const where: Prisma.DoctorAppointmentWhereInput = {};
  if (query.clientId) {
    where.clientId = query.clientId;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.search) {
    where.OR = [
      { doctorName: { contains: query.search, mode: "insensitive" } },
      { specialty: { contains: query.search, mode: "insensitive" } },
      { clinicName: { contains: query.search, mode: "insensitive" } },
      { client: { firstName: { contains: query.search, mode: "insensitive" } } },
      { client: { lastName: { contains: query.search, mode: "insensitive" } } },
    ];
  }
  const total = await prisma.doctorAppointment.count({ where });
  const rows = await prisma.doctorAppointment.findMany({
    where,
    include: appointmentInclude,
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map(serializeDoctorAppointment),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export async function listDoctorAppointmentsForClient(
  userId: string,
  clientId: string,
  scope: "assigned" | "any",
) {
  if (scope === "any") {
    await requireClient(clientId);
  } else {
    await requireOwnedClient(userId, clientId);
  }
  const rows = await prisma.doctorAppointment.findMany({
    where: { clientId },
    include: appointmentInclude,
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });
  return rows.map(serializeDoctorAppointment);
}

export async function getDoctorAppointment(
  userId: string,
  appointmentId: string,
  scope: "assigned" | "any",
) {
  assertUuid(appointmentId);
  const row = await loadAppointment(appointmentId);
  if (!row) {
    throw notFound();
  }
  if (scope === "assigned") {
    await requireOwnedClient(userId, row.clientId);
  }
  return serializeDoctorAppointment(row);
}

export async function createDoctorAppointment(input: {
  clientId: string;
  typeId: string;
  doctorName: string;
  specialty: string;
  phone: string;
  clinicName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  description?: string;
  status?: "scheduled" | "completed" | "cancelled";
}) {
  await requireClientRow(input.clientId);
  await requireType(input.typeId);
  assertTimes(input.startTime, input.endTime);
  const created = await prisma.doctorAppointment.create({
    data: {
      id: randomUUID(),
      clientId: input.clientId,
      typeId: input.typeId,
      doctorName: input.doctorName,
      specialty: input.specialty,
      phone: input.phone,
      clinicName: input.clinicName,
      scheduledDate: parseIsoDate(input.scheduledDate),
      startTime: input.startTime,
      endTime: input.endTime,
      description: input.description ?? "",
      status: input.status ?? "scheduled",
    },
    include: appointmentInclude,
  });
  return serializeDoctorAppointment(created);
}

export async function updateDoctorAppointment(
  appointmentId: string,
  present: Record<string, unknown>,
  value: {
    clientId?: string;
    typeId?: string;
    doctorName?: string;
    specialty?: string;
    phone?: string;
    clinicName?: string;
    scheduledDate?: string;
    startTime?: string;
    endTime?: string;
    description?: string;
    status?: "scheduled" | "completed" | "cancelled";
  },
) {
  assertUuid(appointmentId);
  const current = await prisma.doctorAppointment.findUnique({ where: { id: appointmentId } });
  if (!current) {
    throw notFound();
  }
  if ("clientId" in present && value.clientId) {
    await requireClientRow(value.clientId);
  }
  if ("typeId" in present && value.typeId) {
    await requireType(value.typeId);
  }
  const startTime = "startTime" in present && value.startTime ? value.startTime : current.startTime;
  const endTime = "endTime" in present && value.endTime ? value.endTime : current.endTime;
  if ("startTime" in present || "endTime" in present) {
    assertTimes(startTime, endTime);
  }
  const data: Prisma.DoctorAppointmentUpdateInput = {};
  if ("doctorName" in present && value.doctorName !== undefined) data.doctorName = value.doctorName;
  if ("specialty" in present && value.specialty !== undefined) data.specialty = value.specialty;
  if ("phone" in present && value.phone !== undefined) data.phone = value.phone;
  if ("clinicName" in present && value.clinicName !== undefined) data.clinicName = value.clinicName;
  if ("description" in present && value.description !== undefined) data.description = value.description;
  if ("status" in present && value.status) data.status = value.status;
  if ("clientId" in present && value.clientId) data.client = { connect: { id: value.clientId } };
  if ("typeId" in present && value.typeId) data.type = { connect: { id: value.typeId } };
  if ("scheduledDate" in present && value.scheduledDate) data.scheduledDate = parseIsoDate(value.scheduledDate);
  if ("startTime" in present && value.startTime) data.startTime = value.startTime;
  if ("endTime" in present && value.endTime) data.endTime = value.endTime;
  const updated = await prisma.doctorAppointment.update({
    where: { id: appointmentId },
    data,
    include: appointmentInclude,
  });
  return serializeDoctorAppointment(updated);
}

export async function deleteDoctorAppointment(appointmentId: string): Promise<void> {
  assertUuid(appointmentId);
  const current = await prisma.doctorAppointment.findUnique({
    where: { id: appointmentId },
    select: { id: true },
  });
  if (!current) {
    throw notFound();
  }
  await prisma.doctorAppointment.delete({ where: { id: appointmentId } });
}
