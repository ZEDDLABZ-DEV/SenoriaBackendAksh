import { z } from "zod";
import { validation } from "../lib/errors";
import { clockSchema, isoDateSchema, parseWithSchema } from "./common";

const dailyCompletionSchema = z
  .object({
    date: isoDateSchema,
  })
  .strict();

const cancelSchema = z
  .object({
    appointmentStatus: z.string({ required_error: "appointmentStatus is required" }),
    cancellationReason: z.string().optional(),
  })
  .strict();

const serviceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const serviceIdsSchema = z
  .array(z.string(), { invalid_type_error: "Choose services from the list" })
  .max(30, "Choose 30 services or fewer")
  .superRefine((ids, ctx) => {
    if (ids.some((id) => !serviceIdPattern.test(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose services from the list" });
    }
  });

const appointmentFields = {
  description: z.string().optional(),
  clientId: z.string().min(1).optional(),
  caregiverId: z.string().min(1).optional(),
  scheduledDate: isoDateSchema.optional(),
  startTime: clockSchema.optional(),
  endTime: clockSchema.optional(),
  appointmentType: z.string().optional(),
  instructions: z.string().optional(),
  notes: z.string().optional(),
  locationStreet: z.string().optional(),
  locationCity: z.string().optional(),
  locationState: z.string().optional(),
  locationZipCode: z.string().optional(),
  locationGateCode: z.string().optional(),
  locationNavigation: z.string().optional(),
  appointmentStatus: z.enum(["scheduled", "completed", "cancelled"]).optional(),
  serviceIds: serviceIdsSchema.optional(),
  acknowledgeWarnings: z.boolean().optional(),
};

const createAppointmentSchema = z
  .object({
    description: z.string().default(""),
    clientId: z.string({ required_error: "clientId is required" }).min(1, "clientId is required"),
    caregiverId: z.string({ required_error: "caregiverId is required" }).min(1, "caregiverId is required"),
    scheduledDate: isoDateSchema,
    startTime: clockSchema,
    endTime: clockSchema,
    appointmentType: z.string().default(""),
    instructions: z.string().default(""),
    notes: z.string().default(""),
    locationStreet: z.string().default(""),
    locationCity: z.string().default(""),
    locationState: z.string().default(""),
    locationZipCode: z.string().default(""),
    locationGateCode: z.string().default(""),
    locationNavigation: z.string().default(""),
    serviceIds: serviceIdsSchema.default([]),
    acknowledgeWarnings: z.boolean().default(false),
  })
  .strict();

const updateAppointmentSchema = z.object(appointmentFields).strict();

export function parseDailyCompletion(body: unknown): { date: string } {
  return parseWithSchema(dailyCompletionSchema, body);
}

export function parseCancel(body: unknown): { cancellationReason?: string } {
  const parsed = parseWithSchema(cancelSchema, body);
  if (parsed.appointmentStatus !== "cancelled") {
    throw validation("Only cancellation is supported", {
      appointmentStatus: ["appointmentStatus must be cancelled"],
    });
  }
  if (parsed.cancellationReason === undefined) {
    return {};
  }
  const reason = parsed.cancellationReason.trim();
  if (!reason) {
    throw validation("A cancellation reason is required", {
      cancellationReason: ["A cancellation reason is required"],
    });
  }
  if (reason.length > 2000) {
    throw validation("A cancellation reason is required", {
      cancellationReason: ["cancellationReason must be at most 2000 characters"],
    });
  }
  return { cancellationReason: reason };
}

export function parseCreateAppointment(body: unknown) {
  return parseWithSchema(createAppointmentSchema, body);
}

export function parseUpdateAppointment(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  return {
    present: body as Record<string, unknown>,
    value: parseWithSchema(updateAppointmentSchema, body),
  };
}
