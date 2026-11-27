import { z } from "zod";
import { CALL_DIRECTIONS, CALL_RESULTS, type CallDirection, type CallResult } from "../domain/sales";
import { validation } from "../lib/errors";
import { isIsoDate } from "../lib/dates";
import { parsePageQuery, parseWithSchema, type PageQuery } from "./common";
import { parseOptionalTimeZoneOffset } from "./leads";

export const createCallSchema = z
  .object({
    leadId: z.string().uuid("leadId must be a uuid").nullable().optional(),
    phone: z.string().trim().min(1, "phone is required").max(40, "phone must be at most 40 characters"),
    direction: z.enum(CALL_DIRECTIONS),
    startedAt: z.string().datetime({ offset: true, message: "startedAt must be an ISO datetime" }),
    endedAt: z.string().datetime({ offset: true, message: "endedAt must be an ISO datetime" }).optional(),
    durationSeconds: z.number().int().min(0, "durationSeconds must be zero or greater").optional(),
    result: z.enum(CALL_RESULTS),
    name: z.string().trim().min(1, "name is required").max(120, "name must be at most 120 characters").optional(),
  })
  .strict();

export type TimeBound = { kind: "date"; date: string } | { kind: "instant"; at: Date };

export interface CallListQuery extends PageQuery {
  from?: TimeBound;
  to?: TimeBound;
  ownerId?: string;
  leadId?: string;
  result?: CallResult;
  direction?: CallDirection;
  timeZoneOffset?: string;
}

export function parseCreateCall(body: unknown) {
  return parseWithSchema(createCallSchema, body);
}

export function parseCallListQuery(query: Record<string, unknown>): CallListQuery {
  const page = parsePageQuery(query, 50);
  const errors: Record<string, string[]> = {};
  const timeZoneOffset = readOffset(query, errors);
  const from = readBound(query.from, "from", errors);
  const to = readBound(query.to, "to", errors);
  let ownerId: string | undefined;
  let leadId: string | undefined;
  let result: CallResult | undefined;
  let direction: CallDirection | undefined;

  if (query.ownerId !== undefined) {
    if (typeof query.ownerId !== "string" || !z.string().uuid().safeParse(query.ownerId).success) {
      errors.ownerId = ["ownerId must be a uuid"];
    } else {
      ownerId = query.ownerId;
    }
  }
  if (query.leadId !== undefined) {
    if (typeof query.leadId !== "string" || !z.string().uuid().safeParse(query.leadId).success) {
      errors.leadId = ["leadId must be a uuid"];
    } else {
      leadId = query.leadId;
    }
  }
  if (query.result !== undefined) {
    if (typeof query.result !== "string" || !CALL_RESULTS.includes(query.result as CallResult)) {
      errors.result = ["result is not a valid call result"];
    } else {
      result = query.result as CallResult;
    }
  }
  if (query.direction !== undefined) {
    if (typeof query.direction !== "string" || !CALL_DIRECTIONS.includes(query.direction as CallDirection)) {
      errors.direction = ["direction must be Outbound or Inbound"];
    } else {
      direction = query.direction as CallDirection;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { ...page, from, to, ownerId, leadId, result, direction, timeZoneOffset };
}

function readOffset(query: Record<string, unknown>, errors: Record<string, string[]>): string | undefined {
  try {
    return parseOptionalTimeZoneOffset(query);
  } catch (error) {
    const fieldErrors = (error as { errors?: Record<string, string[]> }).errors;
    if (fieldErrors?.timeZoneOffset) {
      errors.timeZoneOffset = fieldErrors.timeZoneOffset;
      return undefined;
    }
    throw error;
  }
}

function readBound(value: unknown, field: string, errors: Record<string, string[]>): TimeBound | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    errors[field] = [`${field} must be a date or ISO datetime`];
    return undefined;
  }
  if (isIsoDate(value)) {
    return { kind: "date", date: value };
  }
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success) {
    errors[field] = [`${field} must be a date or ISO datetime`];
    return undefined;
  }
  return { kind: "instant", at: new Date(parsed.data) };
}
