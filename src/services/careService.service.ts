import { randomUUID } from "node:crypto";
import { notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { assertUuid } from "../domain/ids";

export async function listServices() {
  const rows = await prisma.careService.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createService(name: string) {
  const existing = await prisma.careService.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    throw validation("That service already exists", { name: ["That service already exists"] });
  }
  const created = await prisma.careService.create({
    data: { id: randomUUID(), name },
  });
  return { id: created.id, name: created.name };
}

export async function updateService(id: string, name: string) {
  assertUuid(id);
  const current = await prisma.careService.findUnique({ where: { id } });
  if (!current) {
    throw notFound();
  }
  const existing = await prisma.careService.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, NOT: { id } },
  });
  if (existing) {
    throw validation("That service already exists", { name: ["That service already exists"] });
  }
  const updated = await prisma.careService.update({ where: { id }, data: { name } });
  return { id: updated.id, name: updated.name };
}

export async function deleteService(id: string): Promise<void> {
  assertUuid(id);
  const current = await prisma.careService.findUnique({ where: { id } });
  if (!current) {
    throw notFound();
  }
  const inUse = await prisma.appointmentService.count({ where: { serviceId: id } });
  if (inUse > 0) {
    throw validation("That service is used by an appointment", {
      name: ["That service is used by an appointment"],
    });
  }
  await prisma.careService.delete({ where: { id } });
}

export async function requireServiceIds(ids: string[]): Promise<string[]> {
  const unique: string[] = [];
  for (const id of ids) {
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length === 0) return [];
  const rows = await prisma.careService.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (rows.length !== unique.length) {
    throw validation("Choose services from the list", {
      serviceIds: ["Choose services from the list"],
    });
  }
  return unique;
}
