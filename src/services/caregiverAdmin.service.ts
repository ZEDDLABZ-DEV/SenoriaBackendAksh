import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertUuid } from "../domain/ids";
import { notFound, validation } from "../lib/errors";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import { pageMeta, type PageQuery } from "../validation/common";
import { invalidateUserSessions, logout } from "./auth.service";

function publicCaregiver(user: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  position: string | null;
  status: string;
}) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.position ?? "",
    phone: user.phone,
    email: user.email,
    avatar: user.avatar,
    status: user.status,
  };
}

export async function listCaregivers(query: PageQuery) {
  const where = { role: "CAREGIVER", status: "active" };
  const total = await prisma.user.count({ where });
  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map((row) => {
      const caregiver = publicCaregiver(row);
      const { status: _status, ...item } = caregiver;
      return item;
    }),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export async function createCaregiver(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  position: string;
  phone?: string;
}) {
  const position = await prisma.caregiverPosition.findUnique({ where: { name: input.position } });
  if (!position) {
    throw validation("Position is not in the catalog", {
      position: ["Position is not in the catalog"],
    });
  }
  try {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        role: "CAREGIVER",
        status: "active",
        position: position.name,
        phone: input.phone ?? null,
      },
    });
    const caregiver = publicCaregiver(user);
    const { status: _status, ...item } = caregiver;
    return item;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw validation("Email is already in use", { email: ["Email is already in use"] });
    }
    throw error;
  }
}

export async function deactivateCaregiver(id: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CAREGIVER") {
    throw notFound();
  }
  const updated = await prisma.user.update({
    where: { id },
    data: { status: "inactive" },
  });
  await logout(id);
  return publicCaregiver(updated);
}

export async function changeCaregiverPassword(id: string, password: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CAREGIVER") {
    throw notFound();
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await invalidateUserSessions(id, tx);
  });
  return publicCaregiver(user);
}

export async function listPositions() {
  const rows = await prisma.caregiverPosition.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createPosition(name: string) {
  const existing = await prisma.caregiverPosition.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    throw validation("That position already exists", { name: ["That position already exists"] });
  }
  const created = await prisma.caregiverPosition.create({
    data: { id: randomUUID(), name },
  });
  return { id: created.id, name: created.name };
}

export async function updatePosition(id: string, name: string) {
  assertUuid(id);
  const current = await prisma.caregiverPosition.findUnique({ where: { id } });
  if (!current) {
    throw notFound();
  }
  const existing = await prisma.caregiverPosition.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, NOT: { id } },
  });
  if (existing) {
    throw validation("That position already exists", { name: ["That position already exists"] });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.caregiverPosition.update({ where: { id }, data: { name } });
    if (current.name !== name) {
      await tx.user.updateMany({ where: { position: current.name }, data: { position: name } });
    }
    return row;
  });
  return { id: updated.id, name: updated.name };
}

export async function deletePosition(id: string): Promise<void> {
  assertUuid(id);
  const current = await prisma.caregiverPosition.findUnique({ where: { id } });
  if (!current) {
    throw notFound();
  }
  const inUse = await prisma.user.count({ where: { position: current.name } });
  if (inUse > 0) {
    throw validation("That caregiver type is assigned to a caregiver", {
      name: ["That caregiver type is assigned to a caregiver"],
    });
  }
  await prisma.caregiverPosition.delete({ where: { id } });
}
