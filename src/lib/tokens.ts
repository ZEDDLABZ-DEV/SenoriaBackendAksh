import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_DAYS = 7;

export type UserRole = "CAREGIVER" | "ADMIN";

export interface AccessTokenClaims {
  sub: string;
}

export function signAccessToken(input: { userId: string }): string {
  return jwt.sign({}, config.jwtSecret, {
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
  return { sub: payload.sub };
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
