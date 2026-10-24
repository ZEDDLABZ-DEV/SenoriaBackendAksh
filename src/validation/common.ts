import type { ZodError } from "zod";
import { validation } from "../lib/errors";
import { isIsoDate } from "../lib/dates";
import { z } from "zod";

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "body";
    errors[key] ??= [];
    errors[key].push(issue.message);
  }
  return errors;
}

export function pageMeta(page: number, pageSize: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

export interface PageQuery {
  page: number;
  pageSize: number;
  search: string;
}

export function parsePageQuery(
  query: Record<string, unknown>,
  defaultPageSize: number,
): PageQuery {
  const errors: Record<string, string[]> = {};
  const pageRaw = query.page === undefined ? "1" : query.page;
  const pageSizeRaw = query.pageSize === undefined ? String(defaultPageSize) : query.pageSize;
  if (typeof pageRaw !== "string" || !/^[1-9]\d*$/.test(pageRaw)) {
    errors.page = ["page must be a positive integer"];
  }
  if (typeof pageSizeRaw !== "string" || !/^[1-9]\d*$/.test(pageSizeRaw)) {
    errors.pageSize = ["pageSize must be a positive integer"];
  }
  const pageSize = Number(pageSizeRaw);
  if (/^[1-9]\d*$/.test(String(pageSizeRaw)) && pageSize > 100) {
    errors.pageSize = ["pageSize must be at most 100"];
  }
  let search = "";
  if (query.search !== undefined) {
    if (typeof query.search !== "string") {
      errors.search = ["search must be a string"];
    } else {
      search = query.search.trim();
      if (search.length > 100) {
        errors.search = ["search must be at most 100 characters"];
      }
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }
  return { page: Number(pageRaw), pageSize, search };
}

export function parseWithSchema<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validation("Validation failed", zodFieldErrors(parsed.error));
  }
  return parsed.data;
}

export const isoDateSchema = z
  .string({ required_error: "Date is required" })
  .refine((value) => isIsoDate(value), "Date must be a real calendar date in YYYY-MM-DD form");

export const clockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm");

const CAREGIVER_EMAIL = /^[\w.\-]+@([\w\-]+\.)+[\w\-]{2,}$/;

export const caregiverEmailSchema = z
  .string({ required_error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .regex(CAREGIVER_EMAIL, "Email is not valid");
