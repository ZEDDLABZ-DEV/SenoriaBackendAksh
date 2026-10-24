import { z } from "zod";
import { validation } from "../lib/errors";
import { isoDateSchema, parsePageQuery, parseWithSchema, type PageQuery } from "./common";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm");

const statusSchema = z.enum(["scheduled", "completed", "cancelled"]);

const text = (label: string, max: number) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

const createSchema = z
  .object({
    clientId: z.string({ required_error: "clientId is required" }).trim().min(1, "clientId is required"),
    typeId: z.string({ required_error: "typeId is required" }).trim().min(1, "typeId is required"),
    doctorName: text("doctorName", 120),
    specialty: text("specialty", 120),
    phone: text("phone", 40),
    clinicName: text("clinicName", 120),
    scheduledDate: isoDateSchema,
    startTime: clockSchema,
    endTime: clockSchema,
    description: z.string().trim().max(2000, "description must be at most 2000 characters").default(""),
    status: statusSchema.default("scheduled"),
  })
  .strict();

const updateSchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
    typeId: z.string().trim().min(1).optional(),
    doctorName: text("doctorName", 120).optional(),
    specialty: text("specialty", 120).optional(),
    phone: text("phone", 40).optional(),
    clinicName: text("clinicName", 120).optional(),
    scheduledDate: isoDateSchema.optional(),
    startTime: clockSchema.optional(),
    endTime: clockSchema.optional(),
    description: z.string().trim().max(2000, "description must be at most 2000 characters").optional(),
    status: statusSchema.optional(),
  })
  .strict();

const typeNameSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80, "name must be at most 80 characters"),
  })
  .strict();

export function parseCreateDoctorAppointment(body: unknown) {
  return parseWithSchema(createSchema, body);
}

export function parseUpdateDoctorAppointment(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  return {
    present: body as Record<string, unknown>,
    value: parseWithSchema(updateSchema, body),
  };
}

export function parseDoctorAppointmentType(body: unknown) {
  return parseWithSchema(typeNameSchema, body);
}

export interface DoctorListQuery extends PageQuery {
  clientId?: string;
  status?: "scheduled" | "completed" | "cancelled";
}

export function parseDoctorListQuery(query: Record<string, unknown>): DoctorListQuery {
  const page = parsePageQuery(query, 50);
  const errors: Record<string, string[]> = {};
  let clientId: string | undefined;
  let status: DoctorListQuery["status"];
  if (query.clientId !== undefined) {
    if (typeof query.clientId !== "string" || !UUID_PATTERN.test(query.clientId)) {
      errors.clientId = ["clientId is not valid"];
    } else {
      clientId = query.clientId;
    }
  }
  if (query.status !== undefined) {
    const parsed = statusSchema.safeParse(query.status);
    if (!parsed.success) {
      errors.status = ["status must be scheduled, completed, or cancelled"];
    } else {
      status = parsed.data;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { ...page, clientId, status };
}
