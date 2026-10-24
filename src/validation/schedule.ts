import { z } from "zod";
import { addDays, isIsoDate } from "../lib/dates";
import { validation } from "../lib/errors";
import { weekdayOf } from "../services/scheduleRules";
import { serviceIdsSchema } from "./appointments";
import { clockSchema, isoDateSchema, parseWithSchema } from "./common";

export const MAX_SCHEDULE_RANGE_DAYS = 31;
export const MAX_SERIES_DAYS = 92;
export const MAX_CAREGIVERS_PER_VIEW = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const weekdaySchema = z
  .number({ invalid_type_error: "weekday must be 0 (Sunday) to 6 (Saturday)" })
  .int("weekday must be 0 (Sunday) to 6 (Saturday)")
  .min(0, "weekday must be 0 (Sunday) to 6 (Saturday)")
  .max(6, "weekday must be 0 (Sunday) to 6 (Saturday)");

const slotSchema = z
  .object({ startTime: clockSchema, endTime: clockSchema })
  .strict()
  .refine((slot) => slot.endTime > slot.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

const availabilitySchema = z
  .object({
    windows: z
      .array(z.object({ weekday: weekdaySchema, startTime: clockSchema, endTime: clockSchema }).strict())
      .max(50, "Add 50 availability windows or fewer"),
  })
  .strict();

const timeOffSchema = z
  .object({
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional(),
    startTime: clockSchema.optional(),
    endTime: clockSchema.optional(),
    reason: z.string().trim().max(500, "reason must be at most 500 characters").default(""),
  })
  .strict();

const selectedDatesSchema = z
  .array(isoDateSchema)
  .min(1, "Choose at least one date")
  .max(MAX_SERIES_DAYS, `Choose ${MAX_SERIES_DAYS} dates or fewer`);

const seriesTemplateFields = {
  weekdays: z.array(weekdaySchema).min(1, "Choose at least one day").max(7),
  timeSlots: z.array(slotSchema).min(1, "Add at least one visit time").max(6, "Add 6 visit times or fewer"),
  appointmentType: z.string(),
  description: z.string(),
  instructions: z.string(),
  notes: z.string(),
  locationStreet: z.string(),
  locationCity: z.string(),
  locationState: z.string(),
  locationZipCode: z.string(),
  locationGateCode: z.string(),
  locationNavigation: z.string(),
  serviceIds: serviceIdsSchema,
};

const createSeriesSchema = z
  .object({
    clientId: z.string({ required_error: "clientId is required" }).min(1, "clientId is required"),
    caregiverId: z.string({ required_error: "caregiverId is required" }).min(1, "caregiverId is required"),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    weekdays: seriesTemplateFields.weekdays.optional(),
    dates: selectedDatesSchema.optional(),
    timeSlots: seriesTemplateFields.timeSlots,
    appointmentType: z.string().default(""),
    description: z.string().default(""),
    instructions: z.string().default(""),
    notes: z.string().default(""),
    locationStreet: z.string().optional(),
    locationCity: z.string().optional(),
    locationState: z.string().optional(),
    locationZipCode: z.string().optional(),
    locationGateCode: z.string().optional(),
    locationNavigation: z.string().optional(),
    serviceIds: serviceIdsSchema.default([]),
    acknowledgeWarnings: z.boolean().default(false),
    skipConflicts: z.boolean().default(false),
  })
  .strict();

const updateSeriesSchema = z
  .object({
    fromDate: isoDateSchema.optional(),
    caregiverId: z.string().min(1).optional(),
    endDate: isoDateSchema.optional(),
    weekdays: seriesTemplateFields.weekdays.optional(),
    dates: selectedDatesSchema.optional(),
    timeSlots: seriesTemplateFields.timeSlots.optional(),
    appointmentType: z.string().optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
    notes: z.string().optional(),
    locationStreet: z.string().optional(),
    locationCity: z.string().optional(),
    locationState: z.string().optional(),
    locationZipCode: z.string().optional(),
    locationGateCode: z.string().optional(),
    locationNavigation: z.string().optional(),
    serviceIds: serviceIdsSchema.optional(),
    acknowledgeWarnings: z.boolean().default(false),
    skipConflicts: z.boolean().default(false),
  })
  .strict();

type CreateSeriesBody = z.infer<typeof createSeriesSchema>;

export interface CreateSeriesInput extends CreateSeriesBody {
  startDate: string;
  endDate: string;
  weekdays: number[];
  dates?: string[];
}

export type UpdateSeriesInput = z.infer<typeof updateSeriesSchema>;

function normalizeSelectedDates(dates: string[]): string[] {
  const sorted = [...dates].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw validation("Choose each date only once", { dates: ["dates must be unique"] });
  }
  return sorted;
}

export function weekdaysForDates(dates: string[]): number[] {
  return [...new Set(dates.map((date) => weekdayOf(date)))].sort((left, right) => left - right);
}

function rejectOverlappingSlots(slots: { startTime: string; endTime: string }[], field: string) {
  const sorted = [...slots].sort((left, right) => left.startTime.localeCompare(right.startTime));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startTime < sorted[index - 1].endTime) {
      throw validation("Visit times on the same day cannot overlap", {
        [field]: ["Visit times on the same day cannot overlap"],
      });
    }
  }
}

export function parseAvailability(body: unknown) {
  const parsed = parseWithSchema(availabilitySchema, body);
  for (const window of parsed.windows) {
    if (window.endTime <= window.startTime) {
      throw validation("End time must be after start time", {
        windows: ["End time must be after start time"],
      });
    }
  }
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    rejectOverlappingSlots(
      parsed.windows.filter((window) => window.weekday === weekday),
      "windows",
    );
  }
  return parsed;
}

export function parseTimeOff(body: unknown) {
  const parsed = parseWithSchema(timeOffSchema, body);
  const endDate = parsed.endDate ?? parsed.startDate;
  if (endDate < parsed.startDate) {
    throw validation("End date must be on or after the start date", {
      endDate: ["End date must be on or after the start date"],
    });
  }
  if ((parsed.startTime === undefined) !== (parsed.endTime === undefined)) {
    throw validation("Give both a start and end time, or neither for a full day", {
      endTime: ["Give both a start and end time, or neither for a full day"],
    });
  }
  if (parsed.startTime !== undefined && parsed.endTime !== undefined && parsed.endTime <= parsed.startTime) {
    throw validation("End time must be after start time", { endTime: ["End time must be after start time"] });
  }
  return { ...parsed, endDate };
}

export function parseCreateSeries(body: unknown): CreateSeriesInput {
  const parsed = parseWithSchema(createSeriesSchema, body);
  rejectOverlappingSlots(parsed.timeSlots, "timeSlots");
  const hasDates = parsed.dates !== undefined;
  const hasRange = parsed.startDate !== undefined || parsed.endDate !== undefined || parsed.weekdays !== undefined;
  if (hasDates && hasRange) {
    throw validation("Choose either a repeating range or specific dates, not both", {
      dates: ["Choose either a repeating range or specific dates, not both"],
    });
  }
  if (hasDates) {
    const dates = normalizeSelectedDates(parsed.dates ?? []);
    return {
      ...parsed,
      dates,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      weekdays: weekdaysForDates(dates),
    };
  }
  const errors: Record<string, string[]> = {};
  if (!parsed.startDate) errors.startDate = ["startDate is required"];
  if (!parsed.endDate) errors.endDate = ["endDate is required"];
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return {
    ...parsed,
    dates: undefined,
    startDate: parsed.startDate as string,
    endDate: parsed.endDate as string,
    weekdays: parsed.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
  };
}

export function parseUpdateSeries(body: unknown): UpdateSeriesInput {
  const parsed = parseWithSchema(updateSeriesSchema, body);
  if (parsed.timeSlots) {
    rejectOverlappingSlots(parsed.timeSlots, "timeSlots");
  }
  if (!parsed.dates) return parsed;
  return { ...parsed, dates: normalizeSelectedDates(parsed.dates) };
}

function parseCaregiverIds(raw: unknown, errors: Record<string, string[]>): string[] | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string") {
    errors.caregiverIds = ["caregiverIds must be a comma-separated list"];
    return undefined;
  }
  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.some((id) => !UUID.test(id))) {
    errors.caregiverIds = ["caregiverIds must be caregiver ids"];
  } else if (ids.length > MAX_CAREGIVERS_PER_VIEW) {
    errors.caregiverIds = [`Choose ${MAX_CAREGIVERS_PER_VIEW} caregivers or fewer`];
  }
  return ids;
}

export function parseRangeQuery(query: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};
  const from = typeof query.from === "string" && isIsoDate(query.from) ? query.from : undefined;
  const to = typeof query.to === "string" && isIsoDate(query.to) ? query.to : undefined;
  if (!from) errors.from = ["from must be a YYYY-MM-DD date"];
  if (!to) errors.to = ["to must be a YYYY-MM-DD date"];
  if (from && to) {
    if (to < from) {
      errors.to = ["to must be on or after from"];
    } else if (addDays(from, MAX_SCHEDULE_RANGE_DAYS - 1) < to) {
      errors.to = [`The range can be at most ${MAX_SCHEDULE_RANGE_DAYS} days`];
    }
  }
  const caregiverIds = parseCaregiverIds(query.caregiverIds, errors);
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { from: from as string, to: to as string, caregiverIds };
}

export function parseMonthQuery(query: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};
  const month = typeof query.month === "string" ? query.month : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    errors.month = ["month must be YYYY-MM"];
  }
  const caregiverIds = parseCaregiverIds(query.caregiverIds, errors);
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { month, caregiverIds };
}

export function parseOptionalDateRange(query: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};
  const read = (key: "from" | "to") => {
    const value = query[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !isIsoDate(value)) {
      errors[key] = [`${key} must be a YYYY-MM-DD date`];
      return undefined;
    }
    return value;
  };
  const from = read("from");
  const to = read("to");
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { from, to };
}

export function parseSeriesListQuery(query: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};
  const readId = (field: "caregiverId" | "clientId") => {
    const value = query[field];
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || !UUID.test(value)) {
      errors[field] = [`${field} is not valid`];
      return undefined;
    }
    return value;
  };
  const caregiverId = readId("caregiverId");
  const clientId = readId("clientId");
  let status: string | undefined;
  if (query.status !== undefined && query.status !== "") {
    if (query.status !== "active" && query.status !== "ended") {
      errors.status = ["status must be active or ended"];
    } else {
      status = query.status;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { caregiverId, clientId, status };
}

export function parseFromDateQuery(query: Record<string, unknown>): string | undefined {
  const value = query.fromDate;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw validation("Validation failed", { fromDate: ["fromDate must be a YYYY-MM-DD date"] });
  }
  return value;
}
