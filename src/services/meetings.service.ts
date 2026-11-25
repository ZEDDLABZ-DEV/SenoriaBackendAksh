import { randomUUID } from "node:crypto";
import type { MeetingKind } from "../domain/sales";
import { assertUuid } from "../domain/ids";
import { forbidden, notFound, validation } from "../lib/errors";
import { now } from "../lib/clock";
import { prisma } from "../lib/prisma";
import { addDays } from "../lib/dates";
import { localDateTimeToUtc } from "../lib/timezone";
import type { MeetingRangeQuery } from "../validation/meetings";
import { ensureOutlookMeeting, syncOutlookMeeting } from "../integrations/outlook/sync";
import { appendLeadTimeline, type SalesActor } from "./leads.service";

type MeetingRow = {
  id: string;
  leadId: string | null;
  ownerId: string;
  title: string;
  person: string;
  kind: string;
  startAt: Date;
  endAt: Date;
  deletedAt: Date | null;
};

export async function listMeetings(actor: SalesActor, query: MeetingRangeQuery, timeZone: string) {
  const start = localDateTimeToUtc(query.from, "00:00", timeZone, query.timeZoneOffset);
  const end = localDateTimeToUtc(addDays(query.to, 1), "00:00", timeZone, query.timeZoneOffset);
  const ownerId = actor.role === "SALES" ? actor.id : query.ownerId;
  const rows = await prisma.salesMeeting.findMany({
    where: {
      deletedAt: null,
      startAt: { lt: end },
      endAt: { gt: start },
      ...(ownerId ? { ownerId } : {}),
    },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toMeeting);
}

export async function createMeeting(
  actor: SalesActor,
  input: { leadId: string; title: string; kind: MeetingKind; startAt: string; endAt: string },
) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  assertTimeOrder(startAt, endAt);
  const meetingId = randomUUID();
  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: input.leadId },
      select: { id: true, ownerId: true, firstName: true, lastName: true },
    });
    if (!lead) {
      throw notFound();
    }
    if (actor.role === "SALES" && lead.ownerId !== actor.id) {
      throw forbidden();
    }
    const ownerId = lead.ownerId ?? actor.id;
    await tx.salesMeeting.create({
      data: {
        id: meetingId,
        leadId: lead.id,
        ownerId,
        title: input.title,
        person: `${lead.firstName} ${lead.lastName}`,
        kind: input.kind,
        startAt,
        endAt,
      },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: { nextStep: input.title, nextStepAt: startAt, lastTouchAt: now() },
    });
    await appendLeadTimeline(tx, {
      leadId: lead.id,
      kind: "Meeting",
      text: `${input.kind} scheduled: ${input.title}.`,
      occurredAt: now(),
      actorId: actor.id,
      meta: { meetingKind: input.kind },
    });
  });
  const created = await prisma.salesMeeting.findUniqueOrThrow({ where: { id: meetingId } });
  await syncOutlookMeeting(created.id, "create");
  return toMeeting(created);
}

export async function updateMeeting(
  actor: SalesActor,
  id: string,
  input: { leadId?: string; title?: string; kind?: MeetingKind; startAt?: string; endAt?: string },
) {
  const meeting = await requireMeeting(actor, id);
  let leadId = meeting.leadId;
  let person = meeting.person;
  let ownerId = meeting.ownerId;
  if (input.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: input.leadId },
      select: { id: true, ownerId: true, firstName: true, lastName: true },
    });
    if (!lead) {
      throw notFound();
    }
    if (actor.role === "SALES" && lead.ownerId !== actor.id) {
      throw forbidden();
    }
    leadId = lead.id;
    person = `${lead.firstName} ${lead.lastName}`;
    ownerId = lead.ownerId ?? actor.id;
  }
  const startAt = input.startAt ? new Date(input.startAt) : meeting.startAt;
  const endAt = input.endAt ? new Date(input.endAt) : meeting.endAt;
  assertTimeOrder(startAt, endAt);
  const updated = await prisma.salesMeeting.update({
    where: { id: meeting.id },
    data: {
      title: input.title,
      kind: input.kind,
      startAt,
      endAt,
      leadId,
      person,
      ownerId,
    },
  });
  await syncOutlookMeeting(updated.id, "update");
  return toMeeting(updated);
}

export async function deleteMeeting(actor: SalesActor, id: string) {
  const meeting = await requireMeeting(actor, id);
  await prisma.$transaction(async (tx) => {
    await tx.salesMeeting.update({
      where: { id: meeting.id },
      data: { deletedAt: now() },
    });
    if (meeting.leadId) {
      await appendLeadTimeline(tx, {
        leadId: meeting.leadId,
        kind: "Meeting",
        text: `Meeting removed: ${meeting.title}.`,
        occurredAt: now(),
        actorId: actor.id,
        meta: { meetingKind: meeting.kind, removed: true },
      });
    }
  });
  await syncOutlookMeeting(meeting.id, "delete");
  return { id: meeting.id };
}

/** Pushes one meeting the actor can already open. Graph is not called when Outlook is off. */
export async function pushMeetingOutlook(actor: SalesActor, id: string) {
  const meeting = await requireMeeting(actor, id);
  return ensureOutlookMeeting(meeting.id);
}

async function requireMeeting(actor: SalesActor, id: string): Promise<MeetingRow> {
  assertUuid(id);
  const meeting = await prisma.salesMeeting.findUnique({ where: { id } });
  if (!meeting || meeting.deletedAt) {
    throw notFound();
  }
  if (actor.role === "SALES" && meeting.ownerId !== actor.id) {
    throw forbidden();
  }
  return meeting;
}

function assertTimeOrder(startAt: Date, endAt: Date) {
  if (endAt <= startAt) {
    throw validation("endAt must be after startAt", { endAt: ["endAt must be after startAt"] });
  }
}

function toMeeting(meeting: MeetingRow) {
  return {
    id: meeting.id,
    leadId: meeting.leadId,
    ownerId: meeting.ownerId,
    title: meeting.title,
    person: meeting.person,
    kind: meeting.kind,
    startAt: meeting.startAt.toISOString(),
    endAt: meeting.endAt.toISOString(),
  };
}
