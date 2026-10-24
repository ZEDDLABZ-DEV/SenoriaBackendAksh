import { z } from "zod";
import { CARE_PLAN_STATUS_VALUES, MEDICATION_SCHEDULES } from "../domain/enums";
import { validation } from "../lib/errors";
import { isoDateSchema, parseWithSchema } from "./common";

const checkInSchema = z
  .object({
    timestamp: z
      .string({ required_error: "timestamp is required" })
      .refine((value) => !Number.isNaN(Date.parse(value)), "timestamp must be an ISO-8601 datetime"),
    location: z
      .object({
        latitude: z
          .number({ required_error: "latitude is required", invalid_type_error: "latitude must be a number" })
          .finite()
          .gte(-90, "latitude must be between -90 and 90")
          .lte(90, "latitude must be between -90 and 90"),
        longitude: z
          .number({ required_error: "longitude is required", invalid_type_error: "longitude must be a number" })
          .finite()
          .gte(-180, "longitude must be between -180 and 180")
          .lte(180, "longitude must be between -180 and 180"),
      })
      .optional(),
    date: isoDateSchema,
    appointmentId: z.string().min(1).optional(),
  })
  .strict();

const toggleSchema = z
  .object({
    itemType: z.string({ required_error: "itemType is required" }),
    itemId: z.string({ required_error: "itemId is required" }).min(1, "itemId is required"),
    date: isoDateSchema,
  })
  .strict();

export interface CheckInBody {
  timestamp: string;
  location?: { latitude: number; longitude: number };
  date: string;
  appointmentId?: string;
}

export function parseCheckIn(body: unknown): CheckInBody {
  return parseWithSchema(checkInSchema, body);
}

export function parseToggle(body: unknown): { itemType: string; itemId: string; date: string } {
  return parseWithSchema(toggleSchema, body);
}

const planSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    goals: z.array(z.string()).optional(),
    status: z.enum(CARE_PLAN_STATUS_VALUES).optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .strict();

const taskSchema = z
  .object({
    name: z.string().optional(),
    frequency: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

const medicationSchema = z
  .object({
    medicationName: z.string().optional(),
    dosage: z.string().optional(),
    schedule: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

const dietSchema = z
  .object({
    meal: z.string().optional(),
    restrictions: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

const hygieneSchema = z
  .object({
    activity: z.string().optional(),
    frequency: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

function requireText(value: string | undefined, field: string): string {
  const text = value?.trim() ?? "";
  if (!text) {
    throw validation(`${field} is required`, { [field]: [`${field} is required`] });
  }
  return text;
}

function optionalSchedule(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (!text) {
    return "";
  }
  if (!(MEDICATION_SCHEDULES as readonly string[]).includes(text)) {
    throw validation("schedule is not recognized", {
      schedule: ["schedule must be OD, BD, TDS, QID, PRN, or HS"],
    });
  }
  return text;
}

export function parseCreateCarePlan(body: unknown) {
  const value = parseWithSchema(planSchema, body);
  return {
    clientId: requireText(value.clientId, "clientId"),
    name: requireText(value.name, "name"),
    description: value.description?.trim() ?? "",
    goals: (value.goals ?? []).map((goal) => goal.trim()).filter((goal) => goal.length > 0),
    status: value.status ?? "active",
    startDate: value.startDate,
    endDate: value.endDate,
  };
}

export function parseUpdateCarePlan(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  return { present: body as Record<string, unknown>, value: parseWithSchema(planSchema, body) };
}

export function parseCreateTask(body: unknown) {
  const value = parseWithSchema(taskSchema, body);
  return {
    name: requireText(value.name, "name"),
    frequency: value.frequency?.trim() ?? "",
    description: value.description?.trim() ?? "",
  };
}

export function parseUpdateTask(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  return { present: body as Record<string, unknown>, value: parseWithSchema(taskSchema, body) };
}

export function parseCreateMedication(body: unknown) {
  const value = parseWithSchema(medicationSchema, body);
  return {
    medicationName: requireText(value.medicationName, "medicationName"),
    dosage: value.dosage?.trim() ?? "",
    schedule: optionalSchedule(value.schedule),
    description: value.description?.trim() ?? "",
  };
}

export function parseUpdateMedication(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  const value = parseWithSchema(medicationSchema, body);
  return {
    present: body as Record<string, unknown>,
    value: {
      ...value,
      schedule: value.schedule === undefined ? undefined : optionalSchedule(value.schedule),
    },
  };
}

export function parseCreateDiet(body: unknown) {
  const value = parseWithSchema(dietSchema, body);
  return {
    meal: requireText(value.meal, "meal"),
    restrictions: value.restrictions?.trim() ?? "",
    description: value.description?.trim() ?? "",
  };
}

export function parseUpdateDiet(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  return { present: body as Record<string, unknown>, value: parseWithSchema(dietSchema, body) };
}

export function parseCreateHygiene(body: unknown) {
  const value = parseWithSchema(hygieneSchema, body);
  return {
    activity: requireText(value.activity, "activity"),
    frequency: value.frequency?.trim() ?? "",
    description: value.description?.trim() ?? "",
  };
}

export function parseUpdateHygiene(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  return { present: body as Record<string, unknown>, value: parseWithSchema(hygieneSchema, body) };
}
