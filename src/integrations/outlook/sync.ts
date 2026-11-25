import { now } from "../../lib/clock";
import { prisma } from "../../lib/prisma";
import { externalSyncData } from "../externalSync";
import { logIntegration } from "../log";
import { isIntegrationEnabled } from "../status";
import { createCalendarEvent, deleteCalendarEvent, graphUtc, updateCalendarEvent, type OutlookEventBody } from "./client";

export type OutlookSyncAction = "create" | "update" | "delete";

export type OutlookEnsureResult =
  | { synced: false; reason: "outlook_not_configured" }
  | { synced: false; reason: "outlook_sync_failed" }
  | { synced: true; eventId: string };

type MeetingSyncRow = {
  id: string;
  title: string;
  person: string;
  kind: string;
  startAt: Date;
  endAt: Date;
  externalSource: string | null;
  externalId: string | null;
};

const chains = new Map<string, Promise<unknown>>();

function exclusive<T>(meetingId: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(meetingId) ?? Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(meetingId, settled);
  void settled.finally(() => {
    if (chains.get(meetingId) === settled) {
      chains.delete(meetingId);
    }
  });
  return run;
}

/**
 * Pushes a meeting to the configured mailbox after it is saved.
 * Disabled Outlook returns without calling Graph. Errors are stored on the meeting and are not rethrown.
 */
export function syncOutlookMeeting(meetingId: string, action: OutlookSyncAction): Promise<void> {
  return exclusive(meetingId, async () => {
    try {
      await apply(meetingId, action);
    } catch (error) {
      logIntegration("failed", { integration: "outlook", meetingId, externalId: await storedEventId(meetingId) });
      await recordFailure(meetingId, error);
    }
  });
}

/**
 * Creates the Outlook event, or updates it when the meeting already has an external id.
 * Does not call Graph when Outlook is disabled.
 */
export function ensureOutlookMeeting(meetingId: string): Promise<OutlookEnsureResult> {
  return exclusive(meetingId, async () => {
    if (!isIntegrationEnabled("outlook")) {
      return { synced: false, reason: "outlook_not_configured" };
    }
    try {
      const eventId = await saveEvent(meetingId);
      return { synced: true, eventId };
    } catch (error) {
      logIntegration("failed", { integration: "outlook", meetingId, externalId: await storedEventId(meetingId) });
      await recordFailure(meetingId, error);
      return { synced: false, reason: "outlook_sync_failed" };
    }
  });
}

async function apply(meetingId: string, action: OutlookSyncAction): Promise<void> {
  if (!isIntegrationEnabled("outlook")) {
    return;
  }
  if (action === "delete") {
    await removeEvent(meetingId);
    return;
  }
  if (action === "update") {
    const meeting = await prisma.salesMeeting.findUnique({
      where: { id: meetingId },
      select: { externalSource: true, externalId: true },
    });
    if (!meeting || meeting.externalSource !== "outlook" || !meeting.externalId) {
      return;
    }
  }
  await saveEvent(meetingId);
}

async function saveEvent(meetingId: string): Promise<string> {
  const meeting = await loadMeeting(meetingId);
  const eventId = await upsertEvent(meeting);
  await prisma.salesMeeting.update({
    where: { id: meeting.id },
    data: externalSyncData("outlook", eventId, now()),
  });
  logIntegration("succeeded", { integration: "outlook", externalId: eventId, meetingId: meeting.id });
  return eventId;
}

async function removeEvent(meetingId: string): Promise<void> {
  const meeting = await prisma.salesMeeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.externalSource !== "outlook" || !meeting.externalId) {
    return;
  }
  await deleteCalendarEvent(meeting.externalId);
  await prisma.salesMeeting.update({
    where: { id: meeting.id },
    data: { lastSyncedAt: now(), syncError: null },
  });
  logIntegration("succeeded", { integration: "outlook", externalId: meeting.externalId, meetingId: meeting.id });
}

async function upsertEvent(meeting: MeetingSyncRow): Promise<string> {
  if (meeting.externalSource && meeting.externalSource !== "outlook") {
    throw new Error("Outlook sync skipped because the meeting is linked to another system");
  }
  const fields = eventFields(meeting);
  if (meeting.externalSource === "outlook" && meeting.externalId) {
    const updated = await updateCalendarEvent(meeting.externalId, fields);
    if (updated !== "missing") {
      return updated;
    }
  }
  return createCalendarEvent({ ...fields, transactionId: meeting.id });
}

async function loadMeeting(meetingId: string): Promise<MeetingSyncRow> {
  const meeting = await prisma.salesMeeting.findUnique({ where: { id: meetingId } });
  if (!meeting) {
    throw new Error("Outlook meeting was not found");
  }
  return meeting;
}

function eventFields(meeting: MeetingSyncRow): OutlookEventBody {
  const subject = meeting.title.trim().slice(0, 255) || "Meeting";
  return {
    subject,
    body: {
      contentType: "Text",
      content: `${meeting.kind} with ${meeting.person}\nSenoria meeting ${meeting.id}`.slice(0, 8000),
    },
    start: graphUtc(meeting.startAt),
    end: graphUtc(meeting.endAt),
    isReminderOn: false,
  };
}

async function storedEventId(meetingId: string): Promise<string | null> {
  const meeting = await prisma.salesMeeting
    .findUnique({ where: { id: meetingId }, select: { externalId: true } })
    .catch(() => null);
  return meeting?.externalId ?? null;
}

async function recordFailure(meetingId: string, error: unknown): Promise<void> {
  const message = syncErrorMessage(error);
  await prisma.salesMeeting
    .update({ where: { id: meetingId }, data: { syncError: message } })
    .catch(() => undefined);
}

function syncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("Outlook ")) {
    return error.message.slice(0, 500);
  }
  return "Outlook request failed";
}
