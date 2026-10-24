import { z } from "zod";
import { HAZARD_WRITE_TYPES, SERVICE_FREQUENCIES } from "../domain/enums";
import { validation } from "../lib/errors";
import { isIsoDate } from "../lib/dates";
import { isoDateSchema, parseWithSchema } from "./common";

export interface ClientListQuery {
  page: number;
  pageSize: number;
  status: "active" | "inactive";
  search: string;
}

function oneString(value: unknown, field: string, errors: Record<string, string[]>): string {
  if (typeof value !== "string") {
    errors[field] = [`${field} is required`];
    return "";
  }
  return value;
}

export function parseClientListQuery(query: Record<string, unknown>): ClientListQuery {
  const errors: Record<string, string[]> = {};
  const pageRaw = oneString(query.page, "page", errors);
  const pageSizeRaw = oneString(query.pageSize, "pageSize", errors);
  const status = oneString(query.status, "status", errors);
  const searchRaw = query.search;

  if (pageRaw && !/^[1-9]\d*$/.test(pageRaw)) {
    errors.page = ["page must be a positive integer"];
  }
  if (pageSizeRaw && !/^[1-9]\d*$/.test(pageSizeRaw)) {
    errors.pageSize = ["pageSize must be a positive integer"];
  }
  const pageSize = Number(pageSizeRaw);
  if (/^[1-9]\d*$/.test(pageSizeRaw) && pageSize > 100) {
    errors.pageSize = ["pageSize must be at most 100"];
  }
  if (status && status !== "active" && status !== "inactive") {
    errors.status = ["status must be active or inactive"];
  }

  let search = "";
  if (searchRaw !== undefined) {
    if (typeof searchRaw !== "string") {
      errors.search = ["search must be a string"];
    } else {
      search = searchRaw.trim();
      if (search.length > 100) {
        errors.search = ["search must be at most 100 characters"];
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw validation("Validation failed", errors);
  }

  return {
    page: Number(pageRaw),
    pageSize,
    status: status as "active" | "inactive",
    search,
  };
}

const addressSchema = z
  .object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    apartment: z.string().optional(),
    gateAccessCode: z.string().optional(),
    navigationInstructions: z.string().optional(),
  })
  .strict();

const createClientSchema = z
  .object({
    firstName: z.string().trim().min(1, "firstName is required"),
    lastName: z.string(),
    dateOfBirth: isoDateSchema,
    phone: z.string().default(""),
    gender: z.enum(["male", "female", "other"]),
    emergencyContactName: z.string().default(""),
    emergencyContactRelation: z.string().default(""),
    emergencyContactPhone: z.string().default(""),
    primaryCondition: z.string(),
    medicalConditions: z.array(z.string()),
    allergies: z.array(z.string()),
    language: z.string(),
    communicationNote: z.string(),
    address: addressSchema,
  })
  .strict();

const updateClientSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    dateOfBirth: z.string().optional(),
    phone: z.string().optional(),
    gender: z.string().optional(),
    email: z.string().optional(),
    status: z.string().optional(),
    emergencyContactName: z.string().optional(),
    emergencyContactRelation: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    primaryCondition: z.string().optional(),
    medicalConditions: z.array(z.string()).optional(),
    allergies: z.array(z.string()).optional(),
    language: z.string().optional(),
    communicationNote: z.string().optional(),
    address: addressSchema.optional(),
    diagnoses: z
      .array(
        z
          .object({
            id: z.string().min(1),
            icdCode: z.string().nullable(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const hazardSchema = z
  .object({
    type: z.enum(HAZARD_WRITE_TYPES),
    description: z.string(),
  })
  .strict();

const serviceRequirementSchema = z
  .object({
    category: z.string().trim().min(1, "category is required"),
    name: z.string().trim().min(1, "name is required"),
    description: z.string().optional(),
    frequency: z.string().optional(),
    specialInstructions: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

function normalizeFrequency(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const match = SERVICE_FREQUENCIES.find((item) => item.toLowerCase() === value.trim().toLowerCase());
  if (!match) {
    throw validation("frequency is not recognized", {
      frequency: ["frequency must be daily, weekly, biweekly, bi-weekly, monthly, or as needed"],
    });
  }
  return match;
}

export function parseCreateClient(body: unknown) {
  return parseWithSchema(createClientSchema, body);
}

export function parseUpdateClient(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  const value = parseWithSchema(updateClientSchema, body);
  if (value.status !== undefined && value.status !== "active" && value.status !== "inactive") {
    throw validation("status must be active or inactive", {
      status: ["status must be active or inactive"],
    });
  }
  if (value.gender !== undefined && value.gender !== "male" && value.gender !== "female" && value.gender !== "other") {
    throw validation("gender must be male, female, or other", {
      gender: ["gender must be male, female, or other"],
    });
  }
  if (value.dateOfBirth !== undefined && value.dateOfBirth !== "" && !isIsoDate(value.dateOfBirth)) {
    throw validation("dateOfBirth must be YYYY-MM-DD", {
      dateOfBirth: ["dateOfBirth must be YYYY-MM-DD"],
    });
  }
  return { present: body as Record<string, unknown>, value };
}

export function parseHazard(body: unknown) {
  return parseWithSchema(hazardSchema, body);
}

export function parseServiceRequirement(body: unknown) {
  const value = parseWithSchema(serviceRequirementSchema, body);
  return {
    ...value,
    description: value.description ?? "",
    frequency: normalizeFrequency(value.frequency),
    specialInstructions: value.specialInstructions ?? "",
    isActive: value.isActive ?? true,
  };
}

export function parseUpdateServiceRequirement(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Validation failed", { body: ["Request body must be an object"] });
  }
  const value = parseWithSchema(serviceRequirementSchema.partial().strict(), body);
  return {
    present: body as Record<string, unknown>,
    value: {
      ...value,
      frequency: "frequency" in (body as object) ? normalizeFrequency(value.frequency) : undefined,
    },
  };
}
