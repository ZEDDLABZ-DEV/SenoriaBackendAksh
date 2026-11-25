import { integrationCredentialValues } from "../../config";
import { outlookAccessToken } from "./auth";
import { outlookEventSegment, outlookHttp, outlookMailboxSegment, readOutlookJson } from "./http";

export type OutlookEventBody = {
  subject: string;
  body: { contentType: "Text"; content: string };
  start: { dateTime: string; timeZone: "UTC" };
  end: { dateTime: string; timeZone: "UTC" };
  isReminderOn: false;
  transactionId?: string;
};

/** Graph dateTimeTimeZone. The instant is UTC and the string has no Z suffix. */
export function graphUtc(date: Date): { dateTime: string; timeZone: "UTC" } {
  const iso = date.toISOString();
  return { dateTime: `${iso.slice(0, 23)}0000`, timeZone: "UTC" };
}

export async function createCalendarEvent(input: OutlookEventBody): Promise<string> {
  const response = await graph("/events", "POST", input);
  const payload = await readOutlookJson(response);
  if (!response.ok) {
    throw new Error(`Outlook request failed with status ${response.status}`);
  }
  const id = readEventId(payload);
  if (!id) {
    throw new Error("Outlook response did not include an event id");
  }
  return id;
}

/** Returns the stored id, or "missing" when Graph responds 404. */
export async function updateCalendarEvent(eventId: string, input: OutlookEventBody): Promise<string | "missing"> {
  const response = await graph(`/events/${outlookEventSegment(eventId)}`, "PATCH", input);
  const payload = await readOutlookJson(response);
  if (response.status === 404) {
    return "missing";
  }
  if (!response.ok) {
    throw new Error(`Outlook request failed with status ${response.status}`);
  }
  return readEventId(payload) ?? eventId;
}

/** 404 means the event is already gone. */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const response = await graph(`/events/${outlookEventSegment(eventId)}`, "DELETE");
  await response.text().catch(() => "");
  if (response.status === 404 || response.ok) {
    return;
  }
  throw new Error(`Outlook request failed with status ${response.status}`);
}

async function graph(path: string, method: string, body?: OutlookEventBody): Promise<Response> {
  const mailbox = outlookMailboxSegment(integrationCredentialValues("outlook").OUTLOOK_CALENDAR_USER);
  const token = await outlookAccessToken();
  return outlookHttp(`https://graph.microsoft.com/v1.0/users/${mailbox}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"',
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function readEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string") {
    return null;
  }
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 1024 || /[\s\u0000-\u001f]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
