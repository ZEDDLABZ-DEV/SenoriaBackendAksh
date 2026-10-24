import { z } from "zod";
import { validation } from "../lib/errors";
import { parseWithSchema } from "./common";

const releaseSchema = z
  .object({
    reason: z
      .string({ required_error: "reason is required" })
      .trim()
      .min(1, "reason is required")
      .max(500, "reason must be at most 500 characters"),
  })
  .strict();

export function parseCoverageReason(body: unknown): { reason: string } {
  return parseWithSchema(releaseSchema, body);
}

export function parseUnreadQuery(query: Record<string, unknown>): boolean {
  if (query.unread === undefined) {
    return false;
  }
  if (query.unread === "true") {
    return true;
  }
  if (query.unread === "false") {
    return false;
  }
  throw validation("Validation failed", { unread: ["unread must be true or false"] });
}
