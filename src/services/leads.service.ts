import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { CLOSED_LEAD_STAGES, type LeadSource, type LeadStage, type NoteOutcome, type QueueFilter, type TimelineKind } from "../domain/sales";
import { assertUuid } from "../domain/ids";
import { forbidden, notFound, validation } from "../lib/errors";
import { now } from "../lib/clock";
import { prisma } from "../lib/prisma";
import { dayBounds, localDateTimeToUtc } from "../lib/timezone";
import type { LeadListQuery } from "../validation/leads";
import { externalSyncData } from "../integrations/externalSync";
import { enqueueZohoNoteSync } from "../integrations/zoho/sync";
import { pageMeta } from "../validation/common";

const CLOSED = new Set<string>(CLOSED_LEAD_STAGES);

export interface SalesActor {
  id: string;
  role: "ADMIN" | "SALES";
}

export interface DayWindow {
  start: Date;
  end: Date;
  today: string;
}

type Rep = { id: string; firstName: string; lastName: string };
type Db = Prisma.TransactionClient | typeof prisma;

type LeadRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  source: string;
  stage: string;
  ownerId: string | null;
  about: string;
  lastTouchAt: Date | null;
  nextStep: string | null;
  nextStepAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  owner: Rep | null;
};

const ownerSelect = { select: { id: true, firstName: true, lastName: true } } as const;

export function requestDayWindow(timeZone: string, timeZoneOffset?: string): DayWindow {
  return dayBounds(now(), timeZone, timeZoneOffset);
}

export async function listLeads(actor: SalesActor, query: LeadListQuery, bounds: DayWindow) {
  const where = leadWhere(actor, query, bounds);
  const total = await prisma.lead.count({ where });
  const rows = await prisma.lead.findMany({
    where,
    include: { owner: ownerSelect },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map((row) => toListItem(row, actor.id, bounds)),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export async function getLead(actor: SalesActor, id: string, bounds: DayWindow) {
  const lead = await requireLead(actor, id);
  return toDetail(lead, actor.id, bounds);
}

export async function createLead(
  actor: SalesActor | null,
  input: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    source: LeadSource;
    about: string;
    ownerId?: string;
    stage?: LeadStage;
    intakeText?: string;
    timelineMeta?: Prisma.InputJsonValue;
    external?: {
      source: "meta" | "zoho";
      id: string;
    };
  },
  bounds: DayWindow,
) {
  const touched = now();
  let manualOwner: Rep | null = null;
  if (input.ownerId) {
    manualOwner = await requireSalesUser(input.ownerId);
  }

  const leadId = randomUUID();
  await prisma.$transaction(async (tx) => {
    let assigned: Rep | null = manualOwner;
    if (!input.ownerId) {
      const locked = await lockRoundRobin(tx);
      const next = nextRep(await activeReps(tx), locked.lastAssignedUserId);
      assigned = next;
      if (next) {
        await tx.salesRoundRobinState.update({
          where: { id: 1 },
          data: { lastAssignedUserId: next.id },
        });
      }
    }

    await tx.lead.create({
      data: {
        id: leadId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        source: input.source,
        stage: input.stage ?? "New",
        ownerId: assigned?.id ?? null,
        about: input.about,
        lastTouchAt: touched,
        ...(input.external ? externalSyncData(input.external.source, input.external.id, touched) : {}),
        ...(input.external?.source === "zoho" ? { zohoRecordId: input.external.id } : {}),
      },
    });
    await appendLeadTimeline(tx, {
      leadId,
      kind: "Lead",
      text: input.intakeText ?? intakeText(input.source),
      occurredAt: touched,
      actorId: actor?.id ?? null,
      sortIndex: 0,
      ...(input.timelineMeta !== undefined ? { meta: input.timelineMeta } : {}),
    });
    if (assigned) {
      await appendLeadTimeline(tx, {
        leadId,
        kind: "Assignment",
        text: `Assigned to ${displayName(assigned)}.`,
        occurredAt: touched,
        actorId: actor?.id ?? null,
        sortIndex: 1,
      });
    } else if (!input.ownerId) {
      await appendLeadTimeline(tx, {
        leadId,
        kind: "Lead",
        text: "No active sales executive for round-robin.",
        occurredAt: touched,
        actorId: actor?.id ?? null,
        sortIndex: 1,
      });
    }
  });

  const reader: SalesActor = actor ?? { id: "00000000-0000-0000-0000-000000000000", role: "ADMIN" };
  return getLead(reader, leadId, bounds);
}

export async function updateLead(
  actor: SalesActor,
  id: string,
  input: {
    about?: string;
    phone?: string;
    email?: string | null;
    nextStep?: string | null;
    nextStepAt?: Date | null;
  },
  bounds: DayWindow,
) {
  await requireLead(actor, id);
  const data: Prisma.LeadUpdateInput = {};
  if (input.about !== undefined) {
    data.about = input.about;
  }
  if (input.phone !== undefined) {
    data.phone = input.phone;
  }
  if (input.email !== undefined) {
    data.email = input.email;
  }
  if (input.nextStep !== undefined) {
    data.nextStep = input.nextStep;
  }
  if (input.nextStepAt !== undefined) {
    data.nextStepAt = input.nextStepAt;
  }
  if (Object.keys(data).length === 0) {
    return getLead(actor, id, bounds);
  }
  try {
    await prisma.lead.update({ where: { id }, data });
  } catch (error) {
    if (isMissing(error)) {
      throw notFound();
    }
    throw error;
  }
  return getLead(actor, id, bounds);
}

export async function changeLeadStage(actor: SalesActor, id: string, stage: LeadStage, bounds: DayWindow) {
  const lead = await requireLead(actor, id);
  const touched = now();
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { stage, lastTouchAt: touched },
    });
    await appendLeadTimeline(tx, {
      leadId: lead.id,
      kind: "Stage",
      text: `Moved to ${stage}.`,
      occurredAt: touched,
      actorId: actor.id,
    });
  });
  return getLead(actor, id, bounds);
}

export async function assignLead(actor: SalesActor, id: string, ownerId: string, bounds: DayWindow) {
  const lead = await requireLead(actor, id);
  const owner = await requireSalesUser(ownerId);
  const touched = now();
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { ownerId: owner.id, lastTouchAt: touched },
    });
    await appendLeadTimeline(tx, {
      leadId: lead.id,
      kind: "Assignment",
      text: `Assigned to ${displayName(owner)}.`,
      occurredAt: touched,
      actorId: actor.id,
    });
  });
  return getLead(actor, id, bounds);
}

export async function addLeadNote(
  actor: SalesActor,
  id: string,
  input: {
    outcome: NoteOutcome;
    text: string;
    followUpDate?: string;
    followUpTime?: string;
    stage?: LeadStage;
  },
  bounds: DayWindow,
  timeZone: string,
  timeZoneOffset?: string,
) {
  const lead = await requireLead(actor, id);
  const touched = now();
  const data: Prisma.LeadUpdateInput = { lastTouchAt: touched };
  if (input.followUpDate) {
    const time = input.followUpTime ?? "09:00";
    data.nextStep = `Follow-up call on ${input.followUpDate} at ${time}`;
    data.nextStepAt = localDateTimeToUtc(input.followUpDate, time, timeZone, timeZoneOffset);
  }
  if (input.stage) {
    data.stage = input.stage;
  }
  let meetingId: string | undefined;
  let noteId = "";
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data });
    noteId = await appendLeadTimeline(tx, {
      leadId: lead.id,
      kind: "Note",
      text: input.text,
      occurredAt: touched,
      actorId: actor.id,
      sortIndex: 0,
      meta: { outcome: input.outcome },
    });
    if (input.stage && input.stage !== lead.stage) {
      await appendLeadTimeline(tx, {
        leadId: lead.id,
        kind: "Stage",
        text: `Moved to ${input.stage}.`,
        occurredAt: touched,
        actorId: actor.id,
        sortIndex: 1,
      });
    }
    if (input.followUpDate && data.nextStepAt instanceof Date && typeof data.nextStep === "string") {
      meetingId = randomUUID();
      await tx.salesMeeting.create({
        data: {
          id: meetingId,
          leadId: lead.id,
          ownerId: lead.ownerId ?? actor.id,
          title: data.nextStep,
          person: displayName(lead),
          kind: "Call",
          startAt: data.nextStepAt,
          endAt: new Date(data.nextStepAt.getTime() + 30 * 60 * 1000),
        },
      });
    }
  });
  const detail = await getLead(actor, id, bounds);
  enqueueZohoNoteSync(lead.id, noteId);
  return meetingId ? { ...detail, meetingId } : detail;
}

export async function queueSummary(actor: SalesActor, bounds: DayWindow, ownerId?: string) {
  const visible: Prisma.LeadWhereInput = actor.role === "SALES" ? { ownerId: actor.id } : {};
  const open: Prisma.LeadWhereInput = { stage: { notIn: CLOSED_LEAD_STAGES } };
  const mineOwnerId = actor.role === "SALES" ? actor.id : (ownerId ?? actor.id);
  const [fresh, due, overdue, mine] = await prisma.$transaction([
    prisma.lead.count({ where: { AND: [visible, { stage: "New" }] } }),
    prisma.lead.count({
      where: { AND: [visible, open, { nextStepAt: { gte: bounds.start, lt: bounds.end } }] },
    }),
    prisma.lead.count({
      where: { AND: [visible, open, { nextStepAt: { lt: bounds.start } }] },
    }),
    prisma.lead.count({ where: { ownerId: mineOwnerId } }),
  ]);
  return { new: fresh, due, overdue, mine };
}

export async function assignmentState() {
  const [reps, state] = await Promise.all([
    activeReps(prisma),
    prisma.salesRoundRobinState.findUnique({ where: { id: 1 } }),
  ]);
  const next = nextRep(reps, state?.lastAssignedUserId ?? null);
  return {
    activeRepIds: reps.map((rep) => rep.id),
    nextOwnerId: next?.id ?? null,
    nextOwnerName: next ? displayName(next) : null,
  };
}

async function requireLead(actor: SalesActor, id: string): Promise<LeadRow & { timeline: TimelineRow[] }> {
  assertUuid(id);
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      owner: ownerSelect,
      timeline: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { sortIndex: "asc" }] },
    },
  });
  if (!lead) {
    throw notFound();
  }
  if (actor.role === "SALES" && lead.ownerId !== actor.id) {
    throw forbidden();
  }
  return lead;
}

async function requireSalesUser(id: string): Promise<Rep> {
  assertUuid(id);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  if (!user || user.role !== "SALES") {
    throw validation("Owner must be a sales user", { ownerId: ["Owner must be a sales user"] });
  }
  return user;
}

function leadWhere(actor: SalesActor, query: LeadListQuery, bounds: DayWindow): Prisma.LeadWhereInput {
  const filters: Prisma.LeadWhereInput[] = [];
  if (actor.role === "SALES") {
    filters.push({ ownerId: actor.id });
  } else if (query.ownerId) {
    filters.push({ ownerId: query.ownerId });
  }
  if (query.stage) {
    filters.push({ stage: query.stage });
  }
  if (query.queue) {
    filters.push(queueWhere(query.queue, actor.id, bounds));
  }
  if (query.search) {
    filters.push({ OR: searchWhere(query.search) });
  }
  return filters.length > 0 ? { AND: filters } : {};
}

function queueWhere(queue: QueueFilter, viewerId: string, bounds: DayWindow): Prisma.LeadWhereInput {
  if (queue === "new") {
    return { stage: "New" };
  }
  if (queue === "mine") {
    return { ownerId: viewerId };
  }
  if (queue === "due") {
    return {
      stage: { notIn: CLOSED_LEAD_STAGES },
      nextStepAt: { gte: bounds.start, lt: bounds.end },
    };
  }
  return {
    stage: { notIn: CLOSED_LEAD_STAGES },
    nextStepAt: { lt: bounds.start },
  };
}

function searchWhere(search: string): Prisma.LeadWhereInput[] {
  const contains = { contains: search, mode: "insensitive" as const };
  const matches: Prisma.LeadWhereInput[] = [
    { firstName: contains },
    { lastName: contains },
    { phone: contains },
    { email: contains },
  ];
  const parts = search.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    matches.push({
      AND: [
        { firstName: { contains: parts[0], mode: "insensitive" } },
        { lastName: { contains: parts.slice(1).join(" "), mode: "insensitive" } },
      ],
    });
  }
  return matches;
}

export function leadListItem(lead: LeadRow, viewerId: string, bounds: DayWindow) {
  return toListItem(lead, viewerId, bounds);
}

function toListItem(lead: LeadRow, viewerId: string, bounds: DayWindow) {
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    email: lead.email,
    source: lead.source,
    stage: lead.stage,
    ownerId: lead.ownerId,
    ownerName: lead.owner ? displayName(lead.owner) : null,
    about: lead.about,
    lastTouchAt: iso(lead.lastTouchAt),
    nextStep: lead.nextStep,
    nextStepAt: iso(lead.nextStepAt),
    queues: queuesFor(lead, viewerId, bounds),
    createdAt: lead.createdAt.toISOString(),
  };
}

type TimelineRow = {
  id: string;
  kind: string;
  text: string;
  occurredAt: Date;
  actorId: string | null;
  meta: Prisma.JsonValue | null;
};

function toDetail(lead: LeadRow & { timeline: TimelineRow[] }, viewerId: string, bounds: DayWindow) {
  return {
    ...toListItem(lead, viewerId, bounds),
    updatedAt: lead.updatedAt.toISOString(),
    timeline: lead.timeline.map((event) => ({
      id: event.id,
      kind: event.kind,
      text: event.text,
      occurredAt: event.occurredAt.toISOString(),
      actorId: event.actorId,
      meta: metaObject(event.meta),
    })),
  };
}

function queuesFor(lead: Pick<LeadRow, "stage" | "ownerId" | "nextStepAt">, viewerId: string, bounds: DayWindow) {
  const queues: string[] = [];
  if (lead.stage === "New") {
    queues.push("new");
  }
  if (lead.nextStepAt && !CLOSED.has(lead.stage)) {
    if (lead.nextStepAt >= bounds.start && lead.nextStepAt < bounds.end) {
      queues.push("due");
    } else if (lead.nextStepAt < bounds.start) {
      queues.push("overdue");
    }
  }
  if (lead.ownerId === viewerId) {
    queues.push("mine");
  }
  return queues;
}

async function activeReps(db: Db): Promise<Rep[]> {
  return db.user.findMany({
    where: { role: "SALES", status: "active" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
}

function nextRep(reps: Rep[], lastAssignedUserId: string | null): Rep | null {
  if (reps.length === 0) {
    return null;
  }
  const index = reps.findIndex((rep) => rep.id === lastAssignedUserId);
  return reps[(index + 1) % reps.length] ?? null;
}

async function lockRoundRobin(tx: Prisma.TransactionClient) {
  await tx.salesRoundRobinState.upsert({
    where: { id: 1 },
    create: { id: 1, lastAssignedUserId: null },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM sales_round_robin_state WHERE id = 1 FOR UPDATE`;
  return tx.salesRoundRobinState.findUniqueOrThrow({ where: { id: 1 } });
}

export async function appendLeadTimeline(
  tx: Prisma.TransactionClient,
  input: {
    leadId: string;
    kind: TimelineKind;
    text: string;
    occurredAt: Date;
    actorId: string | null;
    sortIndex?: number;
    meta?: Prisma.InputJsonValue;
  },
): Promise<string> {
  const id = randomUUID();
  await tx.leadTimelineEvent.create({
    data: {
      id,
      leadId: input.leadId,
      kind: input.kind,
      text: input.text,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      sortIndex: input.sortIndex ?? 0,
      meta: input.meta,
    },
  });
  return id;
}

function intakeText(source: LeadSource): string {
  if (source === "Facebook" || source === "Instagram") {
    return `Lead received from a ${source} lead ad.`;
  }
  if (source === "Phone") {
    return "Lead received by phone.";
  }
  return "Lead received from a referral.";
}

function displayName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function metaObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function isMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
