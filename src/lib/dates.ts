const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new Error("Date must be YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Date must be a real calendar date");
  }
  return date;
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
    if (dates.length > 3660) {
      throw new Error("Date range is too long");
    }
  }
  return dates;
}

export function dateInRange(date: string, start: string | null, end: string | null): boolean {
  if (!start) {
    return false;
  }
  const last = end ?? start;
  return date >= start && date <= last;
}

export function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function formatClock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function weekBounds(anchor: string): { from: string; to: string } {
  const date = parseIsoDate(anchor);
  const weekday = date.getUTCDay();
  const fromMonday = weekday === 0 ? 6 : weekday - 1;
  const from = addDays(anchor, -fromMonday);
  return { from, to: addDays(from, 6) };
}

export function monthBounds(anchor: string): { from: string; to: string } {
  const date = parseIsoDate(anchor);
  const from = formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
  const to = formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
  return { from, to };
}

export function hoursBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) {
    return null;
  }
  const milliseconds = end.getTime() - start.getTime();
  if (milliseconds < 0) {
    return null;
  }
  return Math.round((milliseconds / 3_600_000) * 100) / 100;
}

export function nullableDate(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return formatDate(value);
}
