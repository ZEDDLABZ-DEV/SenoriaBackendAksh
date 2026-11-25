import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_DAYS = 7;

export const USER_ROLES = ["CAREGIVER", "ADMIN", "SALES"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(role: string): role is UserRole {
  return (USER_ROLES as readonly string[]).includes(role);
}

export interface AccessTokenClaims {
  sub: string;
  sessionVersion?: number;
}

export function signAccessToken(input: { userId: string; sessionVersion: number }): string {
  return jwt.sign({ sv: input.sessionVersion }, config.jwtSecret, {
    subject: input.userId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: "HS256",
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"],
  });
  if (typeof payload === "string" || typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Invalid access token");
  }
  if (payload.sv === undefined) {
    return { sub: payload.sub };
  }
  if (typeof payload.sv !== "number" || !Number.isInteger(payload.sv) || payload.sv < 0) {
    throw new Error("Invalid access token");
  }
  return { sub: payload.sub, sessionVersion: payload.sv };
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(`${config.refreshTokenPepper}:${token}`).digest("hex");
}

export function newFamilyId(): string {
  return randomUUID();
}
