import { z } from "zod";
import { caregiverEmailSchema, parseWithSchema } from "./common";

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
