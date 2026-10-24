import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { now } from "../lib/clock";
import { invalidCredentials, refreshExpired, forbidden, unauthenticated, notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { lockUser, lockUserRefreshTokens } from "../lib/rowLock";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  generateOpaqueToken,
  hashRefreshToken,
  newFamilyId,
  signAccessToken,
  type UserRole,
} from "../lib/tokens";

const REFRESH_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

let dummyHashPromise: Promise<string> | undefined;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("dummy-password-not-a-credential");
  return dummyHashPromise;
}

function publicUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatar: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    avatar: user.avatar,
    permissions: [] as string[],
  };
}

function isAccountRole(role: string): role is UserRole {
  return role === "CAREGIVER" || role === "ADMIN";
}

async function issueTokens(tx: Tx, userId: string, familyId = newFamilyId()) {
  const refreshToken = generateOpaqueToken();
  const current = now();
  await tx.refreshToken.create({
    data: {
      id: randomUUID(),
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: new Date(current.getTime() + REFRESH_TTL_MS),
    },
  });
  return {
    accessToken: signAccessToken({ userId }),
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

async function issueLoginSession(userId: string, passwordHash: string) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const fresh = await tx.user.findUnique({ where: { id: userId } });
    if (!fresh || fresh.passwordHash !== passwordHash || fresh.status !== "active" || !isAccountRole(fresh.role)) {
      throw invalidCredentials();
    }
    const tokens = await issueTokens(tx, fresh.id);
    return {
      user: publicUser(fresh),
      ...tokens,
    };
  });
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await verifyPassword(
    user?.passwordHash ?? (await dummyHash()),
    input.password,
  );
  if (!user || !passwordMatches || user.status !== "active" || !isAccountRole(user.role)) {
    throw invalidCredentials();
  }
  return issueLoginSession(user.id, user.passwordHash);
}

export async function loginAdmin(input: { email: string; password: string }) {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await verifyPassword(
    user?.passwordHash ?? (await dummyHash()),
    input.password,
  );
  if (!user || !passwordMatches || user.status !== "active") {
    throw invalidCredentials();
  }
  if (user.role !== "ADMIN") {
    throw forbidden();
  }
  return issueLoginSession(user.id, user.passwordHash);
}

export async function refreshSession(rawToken: string) {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: true },
  });
  const current = now();
  if (
    !existing ||
    existing.revokedAt ||
    existing.expiresAt <= current ||
    existing.user.status !== "active" ||
    !isAccountRole(existing.user.role)
  ) {
    throw refreshExpired();
  }

  const freshUser = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!freshUser || freshUser.status !== "active" || !isAccountRole(freshUser.role)) {
    throw refreshExpired();
  }

  return {
    accessToken: signAccessToken({ userId: freshUser.id }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function logout(userId: string): Promise<void> {
  const current = now();
  await prisma.$transaction(async (tx) => {
    await lockUserRefreshTokens(tx, userId);
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: current },
    });
    await tx.notificationDevice.deleteMany({ where: { caregiverId: userId } });
  });
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.status !== "active") {
    return;
  }
  const token = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(now().getTime() + RESET_TTL_MS),
    },
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  if (password.length < 6) {
    throw validation("Password must be at least 6 characters", {
      password: ["Password must be at least 6 characters"],
    });
  }
  const existing = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
  });
  const current = now();
  if (!existing || existing.usedAt || existing.expiresAt <= current) {
    throw validation("Reset token is invalid or expired", {
      token: ["Reset token is invalid or expired"],
    });
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, existing.userId);
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: existing.id, usedAt: null },
      data: { usedAt: current },
    });
    if (claimed.count !== 1) {
      throw validation("Reset token is invalid or expired", {
        token: ["Reset token is invalid or expired"],
      });
    }
    await tx.user.update({
      where: { id: existing.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await lockUserRefreshTokens(tx, existing.userId);
    await tx.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: current },
    });
  });
}

// Call in the same transaction as a caregiver password change so refresh tokens cannot survive the new hash.
export async function invalidateUserSessions(userId: string, tx?: Tx): Promise<void> {
  if (tx) {
    await revokeSessions(tx, userId);
    return;
  }
  await prisma.$transaction((transaction) => revokeSessions(transaction, userId));
}

async function revokeSessions(tx: Tx, userId: string): Promise<void> {
  await lockUser(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw notFound();
  }
  await lockUserRefreshTokens(tx, userId);
  await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now() },
  });
}
