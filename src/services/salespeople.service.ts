import { Prisma } from "@prisma/client";
import { CLOSED_LEAD_STAGES } from "../domain/sales";
import { assertUuid } from "../domain/ids";
import { notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { SalesListStatus } from "../validation/auth";
import { leadListItem, requestDayWindow, type SalesActor } from "./leads.service";

const CLOSED = new Set<string>(CLOSED_LEAD_STAGES);

export async function listSalespeople(status: SalesListStatus) {
  const users = await prisma.user.findMany({
    where: {
      role: "SALES",
      status: status === "all" ? { in: ["active", "inactive"] } : status,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
  });
  if (users.length === 0) {
    return [];
  }
  const counts = await prisma.lead.groupBy({
    by: ["ownerId"],
    where: {
      ownerId: { in: users.map((user) => user.id) },
      stage: { notIn: CLOSED_LEAD_STAGES },
    },
    _count: { _all: true },
  });
  const countByOwner = new Map(counts.map((row) => [row.ownerId, row._count._all]));
  return users.map((user) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    inRoundRobin: user.status === "active",
    assignedLeadCount: countByOwner.get(user.id) ?? 0,
  }));
}

export async function getSalesperson(actor: SalesActor, id: string, timeZone: string, timeZoneOffset?: string) {
  assertUuid(id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "SALES") {
    throw notFound();
  }
  const bounds = requestDayWindow(timeZone, timeZoneOffset);
  const leads = await prisma.lead.findMany({
    where: { ownerId: user.id },
    include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const current = leads.filter((lead) => !CLOSED.has(lead.stage));
  const past = leads.filter((lead) => CLOSED.has(lead.stage));
  const events = await recentEvents(user.id);
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    stats: {
      open: current.length,
      won: past.filter((lead) => lead.stage === "Won").length,
      lost: past.filter((lead) => lead.stage === "Lost").length,
      overdue: current.filter((lead) => lead.nextStepAt !== null && lead.nextStepAt < bounds.start).length,
    },
    currentLeads: current.map((lead) => leadListItem(lead, actor.id, bounds)),
    pastLeads: past.map((lead) => leadListItem(lead, actor.id, bounds)),
    events,
  };
}

async function recentEvents(repId: string) {
  const [timeline, calls] = await Promise.all([
    prisma.leadTimelineEvent.findMany({
      where: { OR: [{ actorId: repId }, { lead: { ownerId: repId } }] },
      include: { lead: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { sortIndex: "desc" }],
      take: 50,
    }),
    prisma.salesCall.findMany({
      where: { ownerId: repId, leadId: null },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);

  const events = [
    ...timeline.map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      kind: meetingKind(event.kind, event.meta),
      leadId: event.leadId,
      leadName: event.lead ? `${event.lead.firstName} ${event.lead.lastName}` : null,
      text: event.text,
      at: event.occurredAt.getTime(),
    })),
    ...calls.map((call) => ({
      id: call.id,
      occurredAt: call.startedAt.toISOString(),
      kind: "Call",
      leadId: null,
      leadName: call.name,
      text: `${call.direction} call, ${call.result}.`,
      at: call.startedAt.getTime(),
    })),
  ];
  events.sort((left, right) => right.at - left.at);
  return events.slice(0, 50).map(({ at: _at, ...event }) => event);
}

function meetingKind(kind: string, meta: Prisma.JsonValue | null): string {
  if (kind === "Meeting" && meta && typeof meta === "object" && !Array.isArray(meta)) {
    const meetingKindValue = meta.meetingKind;
    if (meetingKindValue === "Visit" || meetingKindValue === "Call") {
      return meetingKindValue;
    }
  }
  return kind;
}
