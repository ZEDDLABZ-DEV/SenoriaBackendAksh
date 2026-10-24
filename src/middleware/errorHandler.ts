import type { NextFunction, Request, Response } from "express";
import { errorBody } from "../http/respond";
import { AppError } from "../lib/errors";
import { logError } from "../lib/logger";

function isJsonParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as { status?: number }).status === 400
  );
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(errorBody("The requested resource was not found.", "NOT_FOUND"));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    res.status(error.status).json(errorBody(error.message, error.code ?? "ERROR", error.errors, error.details));
    return;
  }

  if (isJsonParseError(error)) {
    res.status(400).json(errorBody("Request body must be JSON", "BAD_REQUEST"));
    return;
  }

  const rawPath = req.originalUrl || req.path || "";
  logError("unhandled error", {
    method: req.method,
    path: rawPath.split("?")[0],
    name: error instanceof Error ? error.name : "Error",
  });
  res.status(500).json(errorBody("Something went wrong. Please try again later.", "SERVER_ERROR"));
}
