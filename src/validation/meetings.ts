import { z } from "zod";
import { MEETING_KINDS, type MeetingKind } from "../domain/sales";
import { validation } from "../lib/errors";
import { isoDateSchema, parseWithSchema } from "./common";
import { parseOptionalTimeZoneOffset } from "./leads";

export const createMeetingSchema = z
  .object({
    leadId: z.string().uuid("leadId must be a uuid"),
    title: z.string().trim().min(1, "title is required").max(200, "title must be at most 200 characters"),
    kind: z.enum(MEETING_KINDS),
    startAt: z.string().datetime({ offset: true, message: "startAt must be an ISO datetime" }),
    endAt: z.string().datetime({ offset: true, message: "endAt must be an ISO datetime" }),
  })
  .strict();

export const updateMeetingSchema = z
  .object({
    leadId: z.string().uuid("leadId must be a uuid").optional(),
    title: z.string().trim().min(1, "title is required").max(200, "title must be at most 200 characters").optional(),
    kind: z.enum(MEETING_KINDS).optional(),
    startAt: z.string().datetime({ offset: true, message: "startAt must be an ISO datetime" }).optional(),
    endAt: z.string().datetime({ offset: true, message: "endAt must be an ISO datetime" }).optional(),
  })
  .strict();

export interface MeetingRangeQuery {
  from: string;
  to: string;
  ownerId?: string;
  timeZoneOffset?: string;
}

export function parseCreateMeeting(body: unknown) {
  return parseWithSchema(createMeetingSchema, body);
}

export function parseUpdateMeeting(body: unknown) {
  return parseWithSchema(updateMeetingSchema, body);
}

export function parseMeetingRangeQuery(query: Record<string, unknown>): MeetingRangeQuery {
  const errors: Record<string, string[]> = {};
  const from = readDate(query.from, "from", errors);
  const to = readDate(query.to, "to", errors);
  let ownerId: string | undefined;
  let timeZoneOffset: string | undefined;
  try {
    timeZoneOffset = parseOptionalTimeZoneOffset(query);
  } catch (error) {
    const fieldErrors = (error as { errors?: Record<string, string[]> }).errors;
    if (fieldErrors?.timeZoneOffset) {
      errors.timeZoneOffset = fieldErrors.timeZoneOffset;
    } else {
      throw error;
    }
  }
  if (query.ownerId !== undefined) {
    if (typeof query.ownerId !== "string" || !z.string().uuid().safeParse(query.ownerId).success) {
      errors.ownerId = ["ownerId must be a uuid"];
    } else {
      ownerId = query.ownerId;
    }
  }
  if (!errors.from && !errors.to && from && to && from > to) {
    errors.to = ["to must be on or after from"];
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { from: from as string, to: to as string, ownerId, timeZoneOffset };
}

function readDate(value: unknown, field: string, errors: Record<string, string[]>): string | undefined {
  const parsed = isoDateSchema.safeParse(value);
  if (!parsed.success) {
    errors[field] = parsed.error.issues.map((issue) => issue.message);
    return undefined;
  }
  return parsed.data;
}

export type { MeetingKind };
