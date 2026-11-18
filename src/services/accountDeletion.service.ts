import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assertUuid } from "../domain/ids";
import { now } from "../lib/clock";
import { conflict, forbidden, notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { lockUser } from "../lib/rowLock";
import { pageMeta, type PageQuery } from "../validation/common";

type Tx = Prisma.TransactionClient;

function publicRequest(row: {
  id: string;
  userId: string;
  reason: string | null;
  status: string;
  reviewedById: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    position: string | null;
    status: string;
  };
}) {
  return {
    id: row.id,
    userId: row.userId,
    reason: row.reason,
    status: row.status,
    reviewedById: row.reviewedById,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    user: row.user
      ? {
          id: row.user.id,
          email: row.user.email,
          firstName: row.user.firstName,
          lastName: row.user.lastName,
          phone: row.user.phone,
          position: row.user.position,
          status: row.user.status,
        }
      : undefined,
  };
}

async function revokeAccess(tx: Tx, userId: string): Promise<void> {
  const current = now();
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: current },
  });
  await tx.notificationDevice.deleteMany({ where: { caregiverId: userId } });
  await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}

export async function requestAccountDeletion(userId: string, reason?: string) {
  const trimmedReason = reason?.trim() || null;
  const request = await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== "CAREGIVER") {
      throw forbidden();
    }
    if (user.status === "deletion_pending") {
      throw conflict("An account deletion request is already pending for this account");
    }
    if (user.status !== "active") {
      throw conflict("Only active accounts can request deletion");
    }
    const pending = await tx.accountDeletionRequest.findFirst({
      where: { userId, status: "pending" },
    });
    if (pending) {
      throw conflict("An account deletion request is already pending for this account");
    }
    const created = await tx.accountDeletionRequest.create({
      data: {
        id: randomUUID(),
        userId,
        reason: trimmedReason,
        status: "pending",
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { status: "deletion_pending" },
    });
    await revokeAccess(tx, userId);

    const admins = await tx.user.findMany({
      where: { role: "ADMIN", status: "active" },
      select: { id: true },
    });
    if (admins.length > 0) {
      const name = `${user.firstName} ${user.lastName}`.trim();
      await tx.notification.createMany({
        data: admins.map((admin) => ({
          id: randomUUID(),
          userId: admin.id,
          type: "account_deletion_requested",
          title: "Account deletion requested",
          body: `${name} requested to delete their account.`,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: userId,
        action: "account_deletion_requested",
        entityType: "account_deletion_request",
        entityId: created.id,
      },
    });

    return created;
  });

  return publicRequest(request);
}

export async function listAccountDeletionRequests(query: PageQuery, status = "pending") {
  if (!["pending", "approved", "rejected"].includes(status)) {
    throw validation("Validation failed", { status: ["status must be pending, approved, or rejected"] });
  }
  const where = { status };
  const total = await prisma.accountDeletionRequest.count({ where });
  const rows = await prisma.accountDeletionRequest.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          position: true,
          status: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map((row) => publicRequest(row)),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export async function approveAccountDeletion(requestId: string, adminId: string) {
  assertUuid(requestId);
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw notFound();
    }
    await lockUser(tx, request.userId);
    const fresh = await tx.accountDeletionRequest.findUnique({
      where: { id: requestId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            position: true,
            status: true,
            role: true,
          },
        },
      },
    });
    if (!fresh) {
      throw notFound();
    }
    if (fresh.status !== "pending") {
      throw conflict("This deletion request has already been processed");
    }
    if (fresh.user.role !== "CAREGIVER") {
      throw notFound();
    }
    const resolvedAt = now();
    const resolved = await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: "approved",
        reviewedById: adminId,
        resolvedAt,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            position: true,
            status: true,
          },
        },
      },
    });
    await tx.user.update({
      where: { id: fresh.userId },
      data: { status: "inactive" },
    });
    await revokeAccess(tx, fresh.userId);
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: adminId,
        action: "account_deletion_approved",
        entityType: "account_deletion_request",
        entityId: requestId,
      },
    });
    return {
      ...resolved,
      user: { ...resolved.user, status: "inactive" },
    };
  });
  return publicRequest(updated);
}

export async function rejectAccountDeletion(requestId: string, adminId: string) {
  assertUuid(requestId);
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw notFound();
    }
    await lockUser(tx, request.userId);
    const fresh = await tx.accountDeletionRequest.findUnique({
      where: { id: requestId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            position: true,
            status: true,
            role: true,
          },
        },
      },
    });
    if (!fresh) {
      throw notFound();
    }
    if (fresh.status !== "pending") {
      throw conflict("This deletion request has already been processed");
    }
    if (fresh.user.role !== "CAREGIVER") {
      throw notFound();
    }
    const resolvedAt = now();
    const resolved = await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: "rejected",
        reviewedById: adminId,
        resolvedAt,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            position: true,
            status: true,
          },
        },
      },
    });
    await tx.user.update({
      where: { id: fresh.userId },
      data: { status: "active" },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: adminId,
        action: "account_deletion_rejected",
        entityType: "account_deletion_request",
        entityId: requestId,
      },
    });
    return {
      ...resolved,
      user: { ...resolved.user, status: "active" },
    };
  });
  return publicRequest(updated);
}

/** When admin deactivates a caregiver who has a pending deletion request, close it as approved. */
export async function closePendingDeletionOnDeactivate(tx: Tx, userId: string, adminId: string): Promise<void> {
  const pending = await tx.accountDeletionRequest.findFirst({
    where: { userId, status: "pending" },
  });
  if (!pending) {
    return;
  }
  await tx.accountDeletionRequest.update({
    where: { id: pending.id },
    data: {
      status: "approved",
      reviewedById: adminId,
      resolvedAt: now(),
    },
  });
}
