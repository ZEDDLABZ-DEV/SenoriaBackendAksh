import { logError, logInfo, logWarn } from "../lib/logger";
import type { IntegrationName } from "./types";

export type IntegrationLogOutcome = "succeeded" | "failed" | "skipped";

export type IntegrationLogIds = {
  integration: IntegrationName;
  externalId?: string | null;
  leadId?: string | null;
  meetingId?: string | null;
  callId?: string | null;
  noteId?: string | null;
};

const ID_FIELDS = ["externalId", "leadId", "meetingId", "callId", "noteId"] as const;

/**
 * One line per vendor outcome. Only the integration name, success, and ids are written.
 * Callers must not pass tokens, secrets, or vendor bodies.
 */
export function logIntegration(outcome: IntegrationLogOutcome, ids: IntegrationLogIds): void {
  try {
    const meta: Record<string, unknown> = {
      integration: ids.integration,
      success: outcome === "succeeded",
    };
    for (const key of ID_FIELDS) {
      const value = ids[key];
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) {
        meta[key] = trimmed.slice(0, 256);
      }
    }
    const message =
      outcome === "succeeded"
        ? "integration sync succeeded"
        : outcome === "skipped"
          ? "integration sync skipped"
          : "integration sync failed";
    if (outcome === "succeeded") {
      logInfo(message, meta);
    } else if (outcome === "skipped") {
      logWarn(message, meta);
    } else {
      logError(message, meta);
    }
  } catch {
    // A log failure must not change the API result.
  }
}
