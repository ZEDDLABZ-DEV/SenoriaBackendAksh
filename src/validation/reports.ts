import { z } from "zod";
import { eachDate, isIsoDate, monthBounds, weekBounds } from "../lib/dates";
import { validation } from "../lib/errors";
import { parseWithSchema } from "./common";

const PERIODS = ["daily", "weekly", "monthly", "custom"] as const;
const STATUSES = ["completed", "pending", "missed", "cancelled", "all"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportPeriod = (typeof PERIODS)[number];
export type ReportStatus = (typeof STATUSES)[number];

export interface ReportFilters {
  period: ReportPeriod;
  from: string;
  to: string;
  caregiverId: string | null;
  clientId: string | null;
  status: ReportStatus;
}

function queryValue(query: Record<string, unknown>, field: string, errors: Record<string, string[]>): string | undefined {
  const value = query[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    errors[field] = [`${field} must be a single value`];
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requireDate(value: string | undefined, field: string, errors: Record<string, string[]>): string | undefined {
  if (!value) {
    errors[field] = [`${field} is required`];
    return undefined;
  }
  if (!isIsoDate(value)) {
    errors[field] = [`${field} must be a real calendar date in YYYY-MM-DD form`];
    return undefined;
  }
  return value;
}

function optionalDate(value: string | undefined, field: string, errors: Record<string, string[]>): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!isIsoDate(value)) {
    errors[field] = [`${field} must be a real calendar date in YYYY-MM-DD form`];
    return undefined;
  }
  return value;
}

function optionalUuid(value: string | undefined, field: string, errors: Record<string, string[]>): string | null {
  if (!value) {
    return null;
  }
  if (!UUID_PATTERN.test(value)) {
    errors[field] = [`${field} must be a UUID`];
    return null;
  }
  return value;
}

export function parseReportFilters(query: Record<string, unknown>, today: string): ReportFilters {
  const errors: Record<string, string[]> = {};
  const periodRaw = queryValue(query, "period", errors) ?? "daily";
  const statusRaw = queryValue(query, "status", errors) ?? "completed";
  const date = optionalDate(queryValue(query, "date", errors), "date", errors);
  const fromRaw = queryValue(query, "from", errors);
  const toRaw = queryValue(query, "to", errors);
  const caregiverId = optionalUuid(queryValue(query, "caregiverId", errors), "caregiverId", errors);
  const clientId = optionalUuid(queryValue(query, "clientId", errors), "clientId", errors);

  if (!(PERIODS as readonly string[]).includes(periodRaw)) {
    errors.period = ["period must be daily, weekly, monthly, or custom"];
  }
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    errors.status = ["status must be completed, pending, missed, cancelled, or all"];
  }

  let from: string | undefined;
  let to: string | undefined;
  if (periodRaw === "custom") {
    from = requireDate(fromRaw, "from", errors);
    to = requireDate(toRaw, "to", errors);
    if (from && to && from > to) {
      errors.to = ["to must be on or after from"];
    } else if (from && to && eachDate(from, to).length > 366) {
      errors.to = ["Custom range must be 366 days or fewer"];
    }
  } else if (!errors.period && (periodRaw === "daily" || periodRaw === "weekly" || periodRaw === "monthly")) {
    const anchor = date ?? today;
    if (periodRaw === "daily") {
      from = anchor;
      to = anchor;
    } else if (periodRaw === "weekly") {
      const week = weekBounds(anchor);
      from = week.from;
      to = week.to;
    } else {
      const month = monthBounds(anchor);
      from = month.from;
      to = month.to;
    }
  }

  if (Object.keys(errors).length > 0 || !from || !to) {
    throw validation("Validation failed", errors);
  }

  return {
    period: periodRaw as ReportPeriod,
    from,
    to,
    caregiverId,
    clientId,
    status: statusRaw as ReportStatus,
  };
}

const hourAdjustmentSchema = z
  .object({
    adjustedHours: z
      .number({
        required_error: "adjustedHours is required",
        invalid_type_error: "adjustedHours must be a number",
      })
      .min(0, "adjustedHours must be from 0 to 24")
      .max(24, "adjustedHours must be from 0 to 24")
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
        "adjustedHours must have at most 2 decimal places",
      ),
    reason: z
      .string({ required_error: "reason is required", invalid_type_error: "reason must be a string" })
      .trim()
      .min(1, "reason is required")
      .max(500, "reason must be at most 500 characters"),
  })
  .strict();

export function parseHourAdjustment(body: unknown): { adjustedHours: number; reason: string } {
  return parseWithSchema(hourAdjustmentSchema, body);
}
