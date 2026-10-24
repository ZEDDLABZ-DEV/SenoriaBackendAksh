import type { NextFunction, Request, Response } from "express";
import { setTimeZoneContext } from "../http/requestContext";
import { now } from "../lib/clock";
import { calendarDateInTimeZone, resolveTimeZone } from "../lib/timezone";

export function timezoneMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const timeZone = resolveTimeZone(req.header("x-timezone"));
  setTimeZoneContext(req, timeZone, calendarDateInTimeZone(now(), timeZone));
  next();
}
