import { z } from "zod";
import { validation } from "../lib/errors";
import { caregiverEmailSchema, isoDateSchema, parseWithSchema } from "./common";

const passwordSchema = z
  .string({ required_error: "Password is required" })
  .min(6, "Password must be at least 6 characters");

const loginSchema = z
  .object({
    email: caregiverEmailSchema,
    password: passwordSchema,
    role: z.string().optional(),
  })
  .strict();

const refreshSchema = z
  .object({
    refreshToken: z.string({ required_error: "Refresh token is required" }).min(1, "Refresh token is required"),
  })
  .strict();

const forgotSchema = z
  .object({
    email: caregiverEmailSchema,
  })
  .strict();

const resetSchema = z
  .object({
    token: z.string({ required_error: "token is required" }).min(1, "token is required"),
    password: passwordSchema,
  })
  .strict();

export function parseLogin(body: unknown) {
  return parseWithSchema(loginSchema, body);
}

export function parseRefresh(body: unknown) {
  return parseWithSchema(refreshSchema, body);
}

export function parseForgotPassword(body: unknown) {
  return parseWithSchema(forgotSchema, body);
}

export function parseResetPassword(body: unknown) {
  return parseWithSchema(resetSchema, body);
}

const caregiverAccountSchema = z
  .object({
    firstName: z.string().trim().min(1, "firstName is required"),
    lastName: z.string().trim().min(1, "lastName is required"),
    email: caregiverEmailSchema,
    password: passwordSchema,
    position: z.string().trim().min(1, "position is required"),
    phone: z.string().trim().min(1, "phone is required").optional(),
  })
  .strict();

const positionSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80, "name must be at most 80 characters"),
  })
  .strict();

export function parseCreateCaregiver(body: unknown) {
  return parseWithSchema(caregiverAccountSchema, body);
}

const salesAccountSchema = z
  .object({
    firstName: z.string().trim().min(1, "firstName is required"),
    lastName: z.string().trim().min(1, "lastName is required"),
    dateOfBirth: isoDateSchema,
    email: caregiverEmailSchema,
    password: passwordSchema,
    phone: z.string().trim().min(1, "phone is required"),
  })
  .strict();

export function parseCreateSales(body: unknown) {
  return parseWithSchema(salesAccountSchema, body);
}

const SALES_LIST_STATUSES = ["active", "inactive", "all"] as const;
export type SalesListStatus = (typeof SALES_LIST_STATUSES)[number];

export function parseSalesListStatus(query: Record<string, unknown>): SalesListStatus {
  const raw = query.status;
  if (raw === undefined || raw === "all") {
    return "all";
  }
  if (typeof raw !== "string" || !SALES_LIST_STATUSES.includes(raw as SalesListStatus)) {
    throw validation("Validation failed", {
      status: ["status must be active, inactive, or all"],
    });
  }
  return raw as SalesListStatus;
}

const caregiverPasswordSchema = z
  .object({
    password: passwordSchema,
  })
  .strict();

export function parseCaregiverPassword(body: unknown) {
  return parseWithSchema(caregiverPasswordSchema, body);
}

export function parsePosition(body: unknown) {
  return parseWithSchema(positionSchema, body);
}
