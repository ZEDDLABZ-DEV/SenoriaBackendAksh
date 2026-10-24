import { z } from "zod";
import { parseWithSchema } from "./common";

const tokenSchema = z
  .string({ required_error: "token is required", invalid_type_error: "token is required" })
  .trim()
  .min(1, "token is required");

const platformSchema = z
  .string({ required_error: "platform is required", invalid_type_error: "platform must be ios or android" })
  .refine((value) => value === "ios" || value === "android", "platform must be ios or android");

const registerSchema = z
  .object({
    token: tokenSchema,
    platform: platformSchema,
  })
  .strict();

const removeSchema = z
  .object({
    token: tokenSchema,
  })
  .strict();

export function parseRegisterDevice(body: unknown): { token: string; platform: "ios" | "android" } {
  const parsed = parseWithSchema(registerSchema, body);
  return { token: parsed.token, platform: parsed.platform as "ios" | "android" };
}

export function parseRemoveDevice(body: unknown): { token: string } {
  return parseWithSchema(removeSchema, body);
}
