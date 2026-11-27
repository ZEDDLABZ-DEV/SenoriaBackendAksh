import { z } from "zod";
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  NOTE_OUTCOMES,
  QUEUE_FILTERS,
  type LeadSource,
  type LeadStage,
  type NoteOutcome,
  type QueueFilter,
} from "../domain/sales";
import { validation } from "../lib/errors";
import { calendarDateForOffset } from "../lib/timezone";
import { caregiverEmailSchema, clockSchema, isoDateSchema, parsePageQuery, parseWithSchema, type PageQuery } from "./common";

const leadStageSchema = z.enum(LEAD_STAGES);
const leadSourceSchema = z.enum(LEAD_SOURCES);
const noteOutcomeSchema = z.enum(NOTE_OUTCOMES);
const optionalEmail = z.union([caregiverEmailSchema, z.literal(""), z.null()]).optional();

export const createLeadSchema = z
  .object({
    firstName: z.string().trim().min(1, "firstName is required").max(80, "firstName must be at most 80 characters"),
    lastName: z.string().trim().min(1, "lastName is required").max(80, "lastName must be at most 80 characters"),
    phone: z.string().trim().min(1, "phone is required").max(40, "phone must be at most 40 characters"),
    email: optionalEmail,
    source: leadSourceSchema,
    about: z.string().trim().max(4000, "about must be at most 4000 characters").optional(),
    ownerId: z.string().uuid("ownerId must be a uuid").optional(),
  })
  .strict();

export const updateLeadSchema = z
  .object({
    about: z.string().trim().max(4000, "about must be at most 4000 characters").optional(),
    phone: z.string().trim().min(1, "phone is required").max(40, "phone must be at most 40 characters").optional(),
    email: optionalEmail,
    nextStep: z
      .string()
      .trim()
      .min(1, "nextStep is required")
      .max(500, "nextStep must be at most 500 characters")
      .nullable()
      .optional(),
    nextStepAt: z.string().datetime({ offset: true, message: "nextStepAt must be an ISO datetime" }).nullable().optional(),
  })
  .strict();

export const leadStageBodySchema = z
  .object({
    stage: leadStageSchema,
  })
  .strict();

export const assignLeadSchema = z
  .object({
    ownerId: z.string().uuid("ownerId must be a uuid"),
  })
  .strict();

export const leadNoteSchema = z
  .object({
    outcome: noteOutcomeSchema,
    text: z.string().trim().min(1, "text is required").max(4000, "text must be at most 4000 characters"),
    followUpDate: isoDateSchema.optional(),
    followUpTime: clockSchema.optional(),
    stage: leadStageSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.followUpTime && !value.followUpDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followUpTime"],
        message: "followUpDate is required when followUpTime is set",
      });
    }
  });

export interface LeadListQuery extends PageQuery {
  stage?: LeadStage;
  ownerId?: string;
  queue?: QueueFilter;
  timeZoneOffset?: string;
}

export function parseCreateLead(body: unknown) {
  const parsed = parseWithSchema(createLeadSchema, body);
  return {
    ...parsed,
    email: normalizeEmail(parsed.email),
    about: parsed.about ?? "",
  };
}

export function parseUpdateLead(body: unknown) {
  const parsed = parseWithSchema(updateLeadSchema, body);
  return {
    ...parsed,
    email: parsed.email === undefined ? undefined : normalizeEmail(parsed.email),
    nextStepAt:
      parsed.nextStepAt === undefined ? undefined : parsed.nextStepAt === null ? null : new Date(parsed.nextStepAt),
  };
}

export function parseLeadStage(body: unknown) {
  return parseWithSchema(leadStageBodySchema, body);
}

export function parseAssignLead(body: unknown) {
  return parseWithSchema(assignLeadSchema, body);
}

export function parseLeadNote(body: unknown) {
  return parseWithSchema(leadNoteSchema, body);
}

export function parseLeadListQuery(query: Record<string, unknown>): LeadListQuery {
  const page = parsePageQuery(query, 50);
  const errors: Record<string, string[]> = {};
  let stage: LeadStage | undefined;
  let ownerId: string | undefined;
  let queue: QueueFilter | undefined;
  const timeZoneOffset = readOffset(query.timeZoneOffset, errors);

  if (query.stage !== undefined) {
    if (typeof query.stage !== "string" || !LEAD_STAGES.includes(query.stage as LeadStage)) {
      errors.stage = ["stage is not a valid lead stage"];
    } else {
      stage = query.stage as LeadStage;
    }
  }
  if (query.ownerId !== undefined) {
    if (typeof query.ownerId !== "string" || !z.string().uuid().safeParse(query.ownerId).success) {
      errors.ownerId = ["ownerId must be a uuid"];
    } else {
      ownerId = query.ownerId;
    }
  }
  if (query.queue !== undefined) {
    if (typeof query.queue !== "string" || !QUEUE_FILTERS.includes(query.queue as QueueFilter)) {
      errors.queue = ["queue must be new, due, overdue, or mine"];
    } else {
      queue = query.queue as QueueFilter;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { ...page, stage, ownerId, queue, timeZoneOffset };
}

export function parseOptionalTimeZoneOffset(query: Record<string, unknown>): string | undefined {
  const errors: Record<string, string[]> = {};
  const timeZoneOffset = readOffset(query.timeZoneOffset, errors);
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return timeZoneOffset;
}

export function parseQueueSummaryQuery(query: Record<string, unknown>): {
  timeZoneOffset?: string;
  ownerId?: string;
} {
  const errors: Record<string, string[]> = {};
  const timeZoneOffset = readOffset(query.timeZoneOffset, errors);
  let ownerId: string | undefined;
  if (query.ownerId !== undefined) {
    if (typeof query.ownerId !== "string" || !z.string().uuid().safeParse(query.ownerId).success) {
      errors.ownerId = ["ownerId must be a uuid"];
    } else {
      ownerId = query.ownerId;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { timeZoneOffset, ownerId };
}

function readOffset(value: unknown, errors: Record<string, string[]>): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    errors.timeZoneOffset = ["timeZoneOffset must be +HH:mm or -HH:mm"];
    return undefined;
  }
  try {
    calendarDateForOffset(new Date(0), value);
  } catch {
    errors.timeZoneOffset = ["timeZoneOffset must be +HH:mm or -HH:mm"];
    return undefined;
  }
  return value.trim();
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (email === undefined || email === null || email.trim() === "") {
    return null;
  }
  return email.trim().toLowerCase();
}

export type { LeadSource, LeadStage, NoteOutcome };
