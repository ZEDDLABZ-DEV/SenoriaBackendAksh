import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function registerDevice(caregiverId: string, token: string, platform: "ios" | "android") {
  try {
    const row = await prisma.notificationDevice.upsert({
      where: { token },
      create: { id: randomUUID(), caregiverId, token, platform },
      update: { caregiverId, platform },
    });
    return { id: row.id, token: row.token, platform: row.platform, caregiverId: row.caregiverId };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await prisma.notificationDevice.update({
        where: { token },
        data: { caregiverId, platform },
      });
      return { id: row.id, token: row.token, platform: row.platform, caregiverId: row.caregiverId };
    }
    throw error;
  }
}

export async function removeDevice(caregiverId: string, token: string) {
  const result = await prisma.notificationDevice.deleteMany({ where: { token, caregiverId } });
  return { deleted: result.count > 0 };
}
