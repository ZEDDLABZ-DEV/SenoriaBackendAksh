import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CallDirection, CallResult } from "../domain/sales";
import { assertUuid } from "../domain/ids";
import { forbidden, notFound, validation } from "../lib/errors";
import { now } from "../lib/clock";
import { prisma } from "../lib/prisma";
import { addDays } from "../lib/dates";
import { localDateTimeToUtc } from "../lib/timezone";
import { externalSyncData } from "../integrations/externalSync";
import type { CallListQuery, TimeBound } from "../validation/calls";
import { pageMeta } from "../validation/common";
import { appendLeadTimeline, type SalesActor } from "./leads.service";

type CallRow = {
  id: string;
  leadId: string | null;
  ownerId: string | null;
  name: string;
  phone: string;
  direction: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  result: string;
  recordingUrl: string | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  lead: { id: string; ownerId: string | null; firstName: string; lastName: string } | null;
};

const callInclude = {
  owner: { select: { id: true, firstName: true, lastName: true } },
  lead: { select: { id: true, ownerId: true, firstName: true, lastName: true } },
} as const;

export async function listCalls(actor: SalesActor, query: CallListQuery, timeZone: string) {
  const where = callWhere(actor, query, timeZone);
  const total = await prisma.salesCall.count({ where });
  const rows = await prisma.salesCall.findMany({
    where,
    include: callInclude,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return {
    data: rows.map((row) => toCall(row, false)),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

export async function getCall(actor: SalesActor, id: string) {
  const call = await requireVisibleCall(actor, id);
  return toCall(call, true);
}

export async function createCall(
  actor: SalesActor,
  input: {
    leadId?: string | null;
    phone: string;
    direction: CallDirection;
    startedAt: string;
    endedAt?: string;
    durationSeconds?: number;
    result: CallResult;
    name?: string;
  },
) {
  const startedAt = new Date(input.startedAt);
  const endedAt = input.endedAt ? new Date(input.endedAt) : null;
  if (endedAt && endedAt < startedAt) {
    throw validation("endedAt must be at or after startedAt", {
      endedAt: ["endedAt must be at or after startedAt"],
    });
  }
  const durationSeconds =
    input.durationSeconds ??
    (endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null);

  const callId = randomUUID();
  await prisma.$transaction(async (tx) => {
    let name = input.name ?? "Unknown caller";
    let ownerId: string | null = actor.id;
    if (input.leadId) {
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
      name = input.name ?? `${lead.firstName} ${lead.lastName}`;
      ownerId = lead.ownerId ?? actor.id;
      await tx.lead.update({
        where: { id: lead.id },
        data: { lastTouchAt: now() },
      });
      await appendLeadTimeline(tx, {
        leadId: lead.id,
        kind: "Call",
        text: `${input.direction} call, ${input.result}.`,
        occurredAt: now(),
        actorId: actor.id,
      });
    }

    await tx.salesCall.create({
      data: {
        id: callId,
        leadId: input.leadId ?? null,
        ownerId,
        name,
        phone: input.phone,
        direction: input.direction,
        startedAt,
        endedAt,
        durationSeconds,
        result: input.result,
        recordingUrl: null,
      },
    });
  });

  return getCall(actor, callId);
}

function callWhere(actor: SalesActor, query: CallListQuery, timeZone: string): Prisma.SalesCallWhereInput {
  const filters: Prisma.SalesCallWhereInput[] = [];
  if (actor.role === "SALES") {
    filters.push({
      OR: [{ leadId: null }, { lead: { ownerId: actor.id } }],
    });
  }
  if (query.ownerId) {
    filters.push({ ownerId: query.ownerId });
  }
  if (query.leadId) {
    filters.push({ leadId: query.leadId });
  }
  if (query.result) {
    filters.push({ result: query.result });
  }
  if (query.direction) {
    filters.push({ direction: query.direction });
  }
  const startedAt: Prisma.DateTimeFilter = {};
  if (query.from) {
    startedAt.gte = boundStart(query.from, timeZone, query.timeZoneOffset);
  }
  if (query.to) {
    if (query.to.kind === "date") {
      startedAt.lt = boundEnd(query.to, timeZone, query.timeZoneOffset);
    } else {
      startedAt.lte = query.to.at;
    }
  }
  if (Object.keys(startedAt).length > 0) {
    filters.push({ startedAt });
  }
  return filters.length > 0 ? { AND: filters } : {};
}

function boundStart(bound: TimeBound, timeZone: string, offset?: string): Date {
  if (bound.kind === "instant") {
    return bound.at;
  }
  return localDateTimeToUtc(bound.date, "00:00", timeZone, offset);
}

function boundEnd(bound: TimeBound, timeZone: string, offset?: string): Date {
  if (bound.kind === "instant") {
    return bound.at;
  }
  return localDateTimeToUtc(addDays(bound.date, 1), "00:00", timeZone, offset);
}

async function requireVisibleCall(actor: SalesActor, id: string): Promise<CallRow> {
  assertUuid(id);
  const call = await prisma.salesCall.findUnique({ where: { id }, include: callInclude });
  if (!call) {
    throw notFound();
  }
  if (actor.role === "SALES" && call.leadId !== null && call.lead?.ownerId !== actor.id) {
    throw forbidden();
  }
  return call;
}

function toCall(call: CallRow, detailed: boolean) {
  const recordingAvailable = call.result === "Connected" && Boolean(call.recordingUrl);
  const body = {
    id: call.id,
    when: call.startedAt.toISOString(),
    leadId: call.leadId,
    name: call.name,
    phone: call.phone,
    direction: call.direction,
    durationSeconds: call.durationSeconds,
    durationLabel: durationLabel(call.durationSeconds),
    result: call.result,
    recordingAvailable,
    ownerId: call.ownerId,
    ownerName: call.owner ? `${call.owner.firstName} ${call.owner.lastName}` : null,
  };
  if (!detailed) {
    return body;
  }
  return {
    ...body,
    startedAt: call.startedAt.toISOString(),
    endedAt: call.endedAt ? call.endedAt.toISOString() : null,
    recordingUrl: call.recordingUrl,
  };
}

function durationLabel(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) {
    return `${remainder} sec`;
  }
  return `${minutes} min ${remainder} sec`;
}

/**
 * Logs one RingCentral call-log record. Manual POST /calls does not use this.
 * A repeated external id updates a missing recording URL and does not add another timeline row.
 */
export async function logRingCentralCall(input: {
  externalId: string;
  leadId: string | null;
  ownerId: string | null;
  name: string;
  phone: string;
  direction: CallDirection;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  result: CallResult;
  recordingUrl: string | null;
  syncError: string | null;
}): Promise<{ id: string; created: boolean; leadId: string | null }> {
  const externalId = input.externalId.trim();
  const phone = input.phone.trim();
  const name = input.name.trim() || "Unknown caller";
  if (!externalId || !phone) {
    throw new Error("RingCentral call is missing an id or phone");
  }

  const existing = await prisma.salesCall.findFirst({
    where: { externalSource: "ringcentral", externalId },
  });
  if (existing) {
    await fillRingCentralRecording(existing, input.recordingUrl);
    return { id: existing.id, created: false, leadId: existing.leadId };
  }

  const callId = randomUUID();
  const syncedAt = now();
  try {
    await prisma.$transaction(async (tx) => {
      if (input.leadId) {
        await tx.lead.update({
          where: { id: input.leadId },
          data: { lastTouchAt: syncedAt },
        });
        await appendLeadTimeline(tx, {
          leadId: input.leadId,
          kind: "Call",
          text: `${input.direction} call, ${input.result}.`,
          occurredAt: syncedAt,
          actorId: null,
        });
      }
      await tx.salesCall.create({
        data: {
          id: callId,
          leadId: input.leadId,
          ownerId: input.ownerId,
          name,
          phone,
          direction: input.direction,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationSeconds: input.durationSeconds,
          result: input.result,
          recordingUrl: input.recordingUrl,
          ...externalSyncData("ringcentral", externalId, syncedAt),
          syncError: input.syncError,
        },
      });
    });
  } catch (error) {
    if (!isUniqueExternal(error)) {
      throw error;
    }
    const winner = await prisma.salesCall.findFirst({
      where: { externalSource: "ringcentral", externalId },
    });
    if (!winner) {
      throw error;
    }
    await fillRingCentralRecording(winner, input.recordingUrl);
    return { id: winner.id, created: false, leadId: winner.leadId };
  }

  return { id: callId, created: true, leadId: input.leadId };
}

async function fillRingCentralRecording(
  existing: { id: string; recordingUrl: string | null },
  recordingUrl: string | null,
): Promise<void> {
  if (existing.recordingUrl || !recordingUrl) {
    return;
  }
  await prisma.salesCall.update({
    where: { id: existing.id },
    data: { recordingUrl, lastSyncedAt: now(), syncError: null },
  });
}

function isUniqueExternal(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
