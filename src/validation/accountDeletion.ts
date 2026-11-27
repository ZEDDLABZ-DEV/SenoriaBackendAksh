import { z } from "zod";
import { validation } from "../lib/errors";
import { parseWithSchema } from "./common";

export const accountDeletionRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "reason cannot be empty")
      .max(500, "reason must be at most 500 characters")
      .optional(),
  })
  .strict();

export function parseAccountDeletionRequest(body: unknown) {
  if (body === undefined || body === null || (typeof body === "object" && Object.keys(body as object).length === 0)) {
    return {};
  }
  return parseWithSchema(accountDeletionRequestSchema, body);
}

export function parseDeletionRequestStatus(query: Record<string, unknown>): string {
  const raw = query.status;
  if (raw === undefined) {
    return "pending";
  }
  if (typeof raw !== "string" || !["pending", "approved", "rejected"].includes(raw)) {
    throw validation("Validation failed", {
      status: ["status must be pending, approved, or rejected"],
    });
  }
  return raw;
}
