export class AppError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly errors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code?: string,
    errors?: Record<string, string[]>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.details = details;
  }
}

export function notFound(): AppError {
  return new AppError(404, "The requested resource was not found.", "NOT_FOUND");
}

export function unauthenticated(): AppError {
  return new AppError(401, "Your session has expired. Please log in again.", "UNAUTHENTICATED");
}

export function refreshExpired(): AppError {
  return new AppError(401, "Your session has expired. Please log in again.", "REFRESH_EXPIRED");
}

export function invalidCredentials(): AppError {
  return new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
}

export function roleNotAllowed(): AppError {
  return new AppError(403, "This account cannot use the caregiver app", "ROLE_NOT_ALLOWED");
}

export function forbidden(
  message = "You do not have permission to do that.",
  code = "FORBIDDEN",
): AppError {
  return new AppError(403, message, code);
}

export function validation(message: string, errors: Record<string, string[]>): AppError {
  return new AppError(422, message, "VALIDATION_ERROR", errors);
}

export function conflict(message: string): AppError {
  return new AppError(409, message, "CONFLICT");
}

export function scheduleWarnings(warnings: unknown[]): AppError {
  return new AppError(
    409,
    "This visit is outside the caregiver's availability. Resend with acknowledgeWarnings to book anyway.",
    "SCHEDULE_WARNING",
    undefined,
    { warnings },
  );
}

export function scheduleConflicts(conflicts: unknown[]): AppError {
  return new AppError(
    422,
    "This caregiver already has a visit during that time",
    "VALIDATION_ERROR",
    { startTime: ["This caregiver already has a visit during that time"] },
    { conflicts },
  );
}
