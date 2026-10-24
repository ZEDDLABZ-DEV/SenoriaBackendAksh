import type { Request } from "express";
import { unauthenticated } from "../lib/errors";
import type { UserRole } from "../lib/tokens";

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
  familyId?: string;
}

export interface RequestContext {
  user: AuthUser;
  timeZone: string;
  today: string;
}

const contexts = new WeakMap<Request, RequestContext>();

export function setRequestContext(req: Request, context: RequestContext): void {
  contexts.set(req, context);
}

export function getRequestContext(req: Request): RequestContext {
  const context = contexts.get(req);
  if (!context?.user.id || !context.today) {
    throw unauthenticated();
  }
  return context;
}

export function setTimeZoneContext(req: Request, timeZone: string, today: string): void {
  const existing = contexts.get(req);
  contexts.set(req, {
    user: existing?.user ?? { id: "", role: "CAREGIVER", email: "" },
    timeZone,
    today,
  });
}

export function attachUser(req: Request, user: AuthUser): void {
  const existing = contexts.get(req);
  contexts.set(req, {
    user,
    timeZone: existing?.timeZone ?? "America/Vancouver",
    today: existing?.today ?? "",
  });
}
