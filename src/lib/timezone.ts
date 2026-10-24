export const DEFAULT_TIME_ZONE = "America/Vancouver";

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 100 || timeZone.includes(" ")) {
    return false;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(header: string | undefined): string {
  if (!header) {
    return DEFAULT_TIME_ZONE;
  }
  const value = header.trim();
  if (!isValidIanaTimeZone(value)) {
    return DEFAULT_TIME_ZONE;
  }
  return value;
}

const OFFSET = /^([+-])?(\d{2}):(\d{2})$/;

export function calendarDateForOffset(instant: Date, offset: string): string {
  const match = OFFSET.exec(offset.trim());
  if (!match) {
    throw new Error("Invalid time zone offset");
  }
  const sign = match[1] === "-" ? -1 : 1;
  const minutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  if (Math.abs(minutes) > 14 * 60) {
    throw new Error("Invalid time zone offset");
  }
  const shifted = new Date(instant.getTime() + minutes * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  let hour = Number(read("hour"));
  if (hour === 24) {
    hour = 0;
  }
  const minute = Number(read("minute"));
  const second = Number(read("second"));
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((wallClockAsUtc - instant.getTime()) / 60000);
}

export function zonedDateTimeToUtc(isoDate: string, clock: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = timeZoneOffsetMinutes(new Date(wallClockAsUtc), timeZone);
  let utc = wallClockAsUtc - firstOffset * 60_000;
  const secondOffset = timeZoneOffsetMinutes(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) {
    utc = wallClockAsUtc - secondOffset * 60_000;
  }
  return new Date(utc);
}

export function formatDateTimeInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = read("hour") === "24" ? "00" : read("hour");
  return `${read("year")}-${read("month")}-${read("day")} ${hour}:${read("minute")}`;
}

export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to resolve the calendar date");
  }
  return `${year}-${month}-${day}`;
}
