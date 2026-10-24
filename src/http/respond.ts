import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { now } from "../lib/clock";

export function sendData(res: Response, data: unknown, message: string, status = 200): void {
  res.status(status).json({
    success: true,
    message,
    data,
    timestamp: now().toISOString(),
    requestId: randomUUID(),
  });
}

export function errorBody(
  message: string,
  code: string,
  errors?: Record<string, string[]>,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  const fieldErrors = errors ?? {};
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    fields[key] = messages[0] ?? "";
  }
  return {
    ...details,
    message,
    code,
    errors: fieldErrors,
    error: {
      message,
      code,
      fields,
    },
  };
}
