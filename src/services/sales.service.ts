import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertUuid } from "../domain/ids";
import { nullableDate, parseIsoDate } from "../lib/dates";
import { forbidden, notFound, validation } from "../lib/errors";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import { pageMeta, type PageQuery } from "../validation/common";
import type { SalesListStatus } from "../validation/auth";
import { invalidateUserSessions } from "./auth.service";

function publicSales(user: {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  email: string;
  phone: string | null;
  status: string;
}) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    dateOfBirth: nullableDate(user.dateOfBirth),
    email: user.email,
    phone: user.phone,
    role: "SALES" as const,
    status: user.status,
  };
}

export async function getSales(actor: { id: string; role: string }, id: string) {
  assertUuid(id);
  if (actor.role === "SALES" && actor.id !== id) {
    throw forbidden();
  }
  if (actor.role !== "ADMIN" && actor.role !== "SALES") {
    throw forbidden();
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "SALES") {
    throw notFound();
  }
  return publicSales(user);
}

export async function listSales(query: PageQuery, status: SalesListStatus) {
  const where = {
    role: "SALES",
    status: status === "all" ? { in: ["active", "inactive"] } : status,
  };
  const total = await prisma.user.count({ where });
  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map(publicSales),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export async function createSales(input: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  password: string;
  phone: string;
}) {
  try {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: parseIsoDate(input.dateOfBirth),
        role: "SALES",
        status: "active",
        phone: input.phone,
      },
    });
    return publicSales(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw validation("Email is already in use", { email: ["Email is already in use"] });
    }
    throw error;
  }
}

export async function deactivateSales(id: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "SALES") {
    throw notFound();
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id },
      data: { status: "inactive" },
    });
    await invalidateUserSessions(id, tx);
    return row;
  });
  return publicSales(updated);
}

export async function changeSalesPassword(id: string, password: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "SALES") {
    throw notFound();
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await invalidateUserSessions(id, tx);
  });
  return publicSales(user);
}

export async function revokeSalesSessions(id: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "SALES") {
    throw notFound();
  }
  await invalidateUserSessions(id);
  return publicSales(user);
}

export async function salesDashboard(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "SALES" || user.status !== "active") {
    throw notFound();
  }
  const profile = publicSales(user);
  const { status: _status, ...dashboard } = profile;
  return dashboard;
}
