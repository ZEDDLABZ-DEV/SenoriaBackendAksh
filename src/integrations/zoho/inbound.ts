import { Prisma } from "@prisma/client";
import type { LeadSource, LeadStage } from "../../domain/sales";
import { now } from "../../lib/clock";
import { logWarn } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { resolveTimeZone } from "../../lib/timezone";
import { appendLeadTimeline, createLead, requestDayWindow, type DayWindow } from "../../services/leads.service";
import { externalSyncData } from "../externalSync";
import { logIntegration } from "../log";
import { mapZohoSource, mapZohoStage, zohoLeadMaps, type ZohoChoice } from "./fieldMap";
import { fetchZohoLeadRecord } from "./leadApi";
import { enqueueZohoLeadOutbound, markZohoInboundLoopGuard } from "./outbound";
import {
  normalizeZohoRecordId,
  parseZohoRecord,
  zohoWebhookRecordCount,
  zohoWebhookRecords,
  type ZohoFieldBag,
} from "./payload";

const MAX_RECORDS = 25;

export type ZohoIngestResult = {
  externalId: string | null;
  leadId: string | null;
  created: boolean;
};

type LeadSnapshot = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  source: string;
  stage: string;
  about: string;
  externalSource: string | null;
  externalId: string | null;
  zohoRecordId: string | null;
};

export async function ingestZohoLeads(body: unknown): Promise<ZohoIngestResult[]> {
  const count = zohoWebhookRecordCount(body);
  if (count > MAX_RECORDS) {
    logWarn("zoho webhook contained more than 25 leads; extra records were ignored", { integration: "zoho" });
  }
  const bounds = requestDayWindow(resolveTimeZone(undefined));
  const results: ZohoIngestResult[] = [];
  for (const record of zohoWebhookRecords(body)) {
    const hinted = parseZohoRecord(record);
    try {
      results.push(await ingestOne(record, hinted, bounds));
    } catch {
      logIntegration("failed", { integration: "zoho", externalId: hinted?.externalId ?? null });
      results.push({ externalId: hinted?.externalId ?? null, leadId: null, created: false });
    }
  }
  return results;
}

async function ingestOne(record: unknown, hinted: ZohoFieldBag | null, bounds: DayWindow): Promise<ZohoIngestResult> {
  if (!hinted) {
    logIntegration("skipped", { integration: "zoho" });
    return { externalId: null, leadId: null, created: false };
  }
  const resolved = await resolveFields(record, hinted);
  if (resolved === "failed") {
    return { externalId: hinted.externalId, leadId: null, created: false };
  }
  if (!resolved) {
    logIntegration("skipped", { integration: "zoho", externalId: hinted.externalId });
    return { externalId: hinted.externalId, leadId: null, created: false };
  }
  const existing = await findByZohoId(resolved.externalId);
  if (existing) {
    return { externalId: resolved.externalId, leadId: await applyUpdate(existing, resolved), created: false };
  }
  const linked = await findByContact(resolved);
  if (linked === "conflict") {
    logIntegration("skipped", { integration: "zoho", externalId: resolved.externalId });
    return { externalId: resolved.externalId, leadId: null, created: false };
  }
  if (linked) {
    return { externalId: resolved.externalId, leadId: await applyUpdate(linked, resolved), created: false };
  }
  return createFromZoho(resolved, bounds);
}

async function resolveFields(record: unknown, hinted: ZohoFieldBag): Promise<ZohoFieldBag | null | "failed"> {
  if (!hinted.idOnly) {
    return hinted;
  }
  try {
    const fetched = await fetchZohoLeadRecord(hinted.externalId);
    if (!fetched) {
      return null;
    }
    return parseZohoRecord(fetched, hinted.externalId);
  } catch {
    logIntegration("failed", { integration: "zoho", externalId: hinted.externalId });
    return "failed";
  }
}

async function createFromZoho(fields: ZohoFieldBag, bounds: DayWindow): Promise<ZohoIngestResult> {
  const names = personName(fields.firstName, fields.lastName);
  const phone = fields.phone ? clip(fields.phone, 40) : "";
  if (!names || !phone) {
    logIntegration("skipped", { integration: "zoho", externalId: fields.externalId });
    return { externalId: fields.externalId, leadId: null, created: false };
  }
  const maps = zohoLeadMaps();
  const source = mapZohoSource(fields.leadSource, maps) ?? { value: maps.sourceDefault, known: true, raw: "" };
  const stage = mapZohoStage(fields.leadStatus, maps) ?? { value: maps.stageDefault, known: true, raw: "" };
  try {
    const lead = await createLead(
      null,
      {
        firstName: names.firstName,
        lastName: names.lastName,
        phone,
        email: fields.emailPresent ? fields.email : null,
        source: source.value,
        stage: stage.value,
        about: composeAbout("", fields, source, stage),
        intakeText: "Lead received from Zoho.",
        timelineMeta: timelineMeta(source, stage),
        external: { source: "zoho", id: fields.externalId },
      },
      bounds,
    );
    ack(lead.id, fields.externalId);
    return { externalId: fields.externalId, leadId: lead.id, created: true };
  } catch (error) {
    if (!isUniqueExternal(error)) {
      throw error;
    }
    const winner = await findByZohoId(fields.externalId);
    if (!winner) {
      logIntegration("failed", { integration: "zoho", externalId: fields.externalId });
      return { externalId: fields.externalId, leadId: null, created: false };
    }
    return { externalId: fields.externalId, leadId: await applyUpdate(winner, fields), created: false };
  }
}

async function applyUpdate(lead: LeadSnapshot, fields: ZohoFieldBag): Promise<string | null> {
  const source = mapZohoSource(fields.leadSource);
  const stage = mapZohoStage(fields.leadStatus);
  const keepExternal = lead.externalSource !== null && lead.externalSource !== "zoho";
  const next = {
    firstName: fields.firstName ? clip(fields.firstName, 80) : lead.firstName,
    lastName: fields.lastName ? clip(fields.lastName, 80) : lead.lastName,
    phone: fields.phone ? clip(fields.phone, 40) : lead.phone,
    email: fields.emailPresent ? fields.email : lead.email,
    source: source ? source.value : lead.source,
    stage: stage ? stage.value : lead.stage,
    about: composeAbout(lead.about, fields, source, stage),
    externalSource: keepExternal ? lead.externalSource : "zoho",
    externalId: keepExternal ? lead.externalId : fields.externalId,
    zohoRecordId: fields.externalId,
  };
  const changed =
    next.firstName !== lead.firstName ||
    next.lastName !== lead.lastName ||
    next.phone !== lead.phone ||
    next.email !== lead.email ||
    next.source !== lead.source ||
    next.stage !== lead.stage ||
    next.about !== lead.about ||
    next.externalSource !== lead.externalSource ||
    next.externalId !== lead.externalId ||
    next.zohoRecordId !== lead.zohoRecordId;
  const syncedAt = now();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          firstName: next.firstName,
          lastName: next.lastName,
          phone: next.phone,
          email: next.email,
          source: next.source,
          stage: next.stage,
          about: next.about,
          ...(keepExternal
            ? { zohoRecordId: fields.externalId, lastSyncedAt: syncedAt, syncError: null }
            : { ...externalSyncData("zoho", fields.externalId, syncedAt), zohoRecordId: fields.externalId }),
          ...(changed ? { lastTouchAt: syncedAt } : {}),
        },
      });
      if (changed) {
        await appendLeadTimeline(tx, {
          leadId: lead.id,
          kind: "Lead",
          text: "Updated from Zoho.",
          occurredAt: syncedAt,
          actorId: null,
          meta: timelineMeta(source, stage),
        });
      }
    });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Zoho lead sync failed").slice(0, 500);
    await prisma.lead.update({ where: { id: lead.id }, data: { syncError: message } }).catch(() => undefined);
    logIntegration("failed", { integration: "zoho", externalId: fields.externalId, leadId: lead.id });
    return lead.id;
  }
  ack(lead.id, fields.externalId);
  return lead.id;
}

function ack(leadId: string, externalId: string): void {
  markZohoInboundLoopGuard(leadId);
  enqueueZohoLeadOutbound(leadId);
  logIntegration("succeeded", { integration: "zoho", externalId, leadId });
}

async function findByZohoId(externalId: string): Promise<LeadSnapshot | null> {
  const prefixed = `zcrm_${externalId}`;
  const rows = await prisma.lead.findMany({
    where: {
      OR: [
        { externalSource: "zoho", externalId },
        { externalSource: "zoho", externalId: prefixed },
        { zohoRecordId: externalId },
        { zohoRecordId: prefixed },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  const match =
    rows.find((row) => row.externalSource === "zoho" && sameZohoId(row.externalId, externalId)) ??
    rows.find((row) => sameZohoId(row.zohoRecordId, externalId)) ??
    null;
  return match ? snapshot(match) : null;
}

async function findByContact(fields: ZohoFieldBag): Promise<LeadSnapshot | "conflict" | null> {
  const digits = phoneDigits(fields.phone ?? "");
  const email = fields.email ?? "";
  if (!digits && !email) {
    return null;
  }
  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM leads
    WHERE (
      ${email} <> '' AND email IS NOT NULL AND lower(email) = lower(${email})
    ) OR (
      ${digits} <> '' AND regexp_replace(phone, '\\D', '', 'g') = ${digits}
    ) OR (
      length(${digits}) >= 10
      AND length(regexp_replace(phone, '\\D', '', 'g')) >= 10
      AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(${digits}, 10)
    )
    ORDER BY created_at ASC
    LIMIT 20
  `);
  if (ids.length === 0) {
    return null;
  }
  const rows = await prisma.lead.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    orderBy: { createdAt: "asc" },
  });
  const usable = rows.filter((row) => !blockedByOtherZoho(row, fields.externalId));
  if (usable.length === 0) {
    return rows.length > 0 ? "conflict" : null;
  }
  const phoneMatch = usable.find((row) => phonesMatch(row.phone, fields.phone ?? ""));
  const emailMatch = email
    ? usable.find((row) => (row.email ?? "").toLowerCase() === email.toLowerCase())
    : undefined;
  const chosen = phoneMatch ?? emailMatch ?? null;
  return chosen ? snapshot(chosen) : null;
}

function blockedByOtherZoho(
  row: { externalSource: string | null; externalId: string | null; zohoRecordId: string | null },
  externalId: string,
): boolean {
  if (row.externalSource === "zoho" && row.externalId && !sameZohoId(row.externalId, externalId)) {
    return true;
  }
  if (row.zohoRecordId && !sameZohoId(row.zohoRecordId, externalId)) {
    return true;
  }
  return false;
}

function sameZohoId(stored: string | null, externalId: string): boolean {
  if (!stored) {
    return false;
  }
  return normalizeZohoRecordId(stored) === externalId || stored === externalId;
}

function snapshot(row: LeadSnapshot): LeadSnapshot {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    email: row.email,
    source: row.source,
    stage: row.stage,
    about: row.about,
    externalSource: row.externalSource,
    externalId: row.externalId,
    zohoRecordId: row.zohoRecordId,
  };
}

function personName(first: string | null, last: string | null): { firstName: string; lastName: string } | null {
  const firstName = (first ?? "").trim();
  const lastName = (last ?? "").trim();
  if (!firstName && !lastName) {
    return null;
  }
  return {
    firstName: clip(firstName || lastName, 80),
    lastName: clip(lastName || firstName, 80),
  };
}

function composeAbout(
  existing: string,
  fields: ZohoFieldBag,
  source: ZohoChoice<LeadSource> | null,
  stage: ZohoChoice<LeadStage> | null,
): string {
  const base = (fields.descriptionPresent ? (fields.description ?? "") : stripRawLines(existing)).trim();
  const sourceLine = rawLine("Zoho Lead_Source:", source, existing);
  const statusLine = rawLine("Zoho Lead_Status:", stage, existing);
  return [base, sourceLine, statusLine].filter((line): line is string => !!line).join("\n").slice(0, 4000);
}

function rawLine(prefix: string, choice: { known: boolean; raw: string } | null, existing: string): string | null {
  if (choice) {
    return !choice.known && choice.raw ? `${prefix} ${choice.raw}` : null;
  }
  return existing.split("\n").find((line) => line.startsWith(prefix)) ?? null;
}

function stripRawLines(about: string): string {
  return about
    .split("\n")
    .filter((line) => !line.startsWith("Zoho Lead_Source:") && !line.startsWith("Zoho Lead_Status:"))
    .join("\n")
    .trim();
}

function timelineMeta(
  source: ZohoChoice<LeadSource> | null,
  stage: ZohoChoice<LeadStage> | null,
): Prisma.InputJsonObject {
  return {
    origin: "zoho",
    direction: "inbound",
    ...(source?.raw
      ? { leadSource: source.raw, mappedSource: source.value, unmappedSource: !source.known }
      : {}),
    ...(stage?.raw ? { leadStatus: stage.raw, mappedStage: stage.value, unmappedStatus: !stage.known } : {}),
  };
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function phonesMatch(stored: string, incoming: string): boolean {
  const left = phoneDigits(stored);
  const right = phoneDigits(incoming);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.length >= 10 && right.length >= 10 && left.slice(-10) === right.slice(-10);
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function isUniqueExternal(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
