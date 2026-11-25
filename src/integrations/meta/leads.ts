import { Prisma } from "@prisma/client";
import { integrationCredentialValues } from "../../config";
import type { LeadSource } from "../../domain/sales";
import { prisma } from "../../lib/prisma";
import { createLead, requestDayWindow, type DayWindow } from "../../services/leads.service";
import { resolveTimeZone } from "../../lib/timezone";
import { logIntegration } from "../log";
import { isIntegrationEnabled } from "../status";
import { metaLeadFieldMap, type MetaFieldMap } from "./fieldMap";
import { fetchMetaLead, type MetaFieldData } from "./graph";

export type MetaIngestResult = {
  leadgenId: string;
  leadId: string | null;
  created: boolean;
};

type LeadgenItem = {
  leadgenId: string;
  pageId: string;
  platform?: string;
  fieldData?: MetaFieldData[];
};

export async function ingestMetaLeadgen(body: unknown): Promise<MetaIngestResult[]> {
  if (!isIntegrationEnabled("meta")) {
    return [];
  }
  const bounds = requestDayWindow(resolveTimeZone(undefined));
  const results: MetaIngestResult[] = [];
  for (const item of leadgenItems(body)) {
    results.push(await ingestOne(item, bounds));
  }
  return results;
}

async function ingestOne(item: LeadgenItem, bounds: DayWindow): Promise<MetaIngestResult> {
  const pageId = integrationCredentialValues("meta").META_PAGE_ID;
  if (item.pageId && pageId && item.pageId !== pageId) {
    logIntegration("skipped", { integration: "meta", externalId: item.leadgenId });
    return { leadgenId: item.leadgenId, leadId: null, created: false };
  }

  const existing = await prisma.lead.findFirst({
    where: { externalSource: "meta", externalId: item.leadgenId },
    select: { id: true },
  });
  if (existing) {
    logIntegration("succeeded", { integration: "meta", externalId: item.leadgenId, leadId: existing.id });
    return { leadgenId: item.leadgenId, leadId: existing.id, created: false };
  }

  const detail = item.fieldData
    ? { id: item.leadgenId, fieldData: item.fieldData, platform: item.platform }
    : await fetchMetaLead(item.leadgenId);
  const mapped = mapMetaLead(detail.fieldData, metaLeadFieldMap(), detail.platform ?? item.platform);
  if (!mapped) {
    logIntegration("skipped", { integration: "meta", externalId: item.leadgenId });
    return { leadgenId: item.leadgenId, leadId: null, created: false };
  }

  try {
    const lead = await createLead(
      null,
      {
        firstName: mapped.firstName,
        lastName: mapped.lastName,
        phone: mapped.phone,
        email: mapped.email,
        source: mapped.source,
        about: "",
        external: { source: "meta", id: item.leadgenId },
      },
      bounds,
    );
    logIntegration("succeeded", { integration: "meta", externalId: item.leadgenId, leadId: lead.id });
    return { leadgenId: item.leadgenId, leadId: lead.id, created: true };
  } catch (error) {
    if (!isUniqueExternal(error)) {
      if (!(error instanceof Error && error.message.startsWith("Meta lead fetch"))) {
        logIntegration("failed", { integration: "meta", externalId: item.leadgenId });
      }
      throw error;
    }
    const winner = await prisma.lead.findFirst({
      where: { externalSource: "meta", externalId: item.leadgenId },
      select: { id: true },
    });
    logIntegration("succeeded", {
      integration: "meta",
      externalId: item.leadgenId,
      leadId: winner?.id ?? null,
    });
    return { leadgenId: item.leadgenId, leadId: winner?.id ?? null, created: false };
  }
}

export function mapMetaLead(
  fieldData: MetaFieldData[],
  fieldMap: MetaFieldMap,
  platform: string | undefined,
): { firstName: string; lastName: string; phone: string; email: string | null; source: LeadSource } | null {
  const first = fieldValue(fieldData, fieldMap.firstName);
  const last = fieldValue(fieldData, fieldMap.lastName);
  const full = fieldValue(fieldData, fieldMap.fullName);
  const names = splitName(first, last, full);
  const phone = fieldValue(fieldData, fieldMap.phone);
  if (!names || !phone) {
    return null;
  }
  const email = fieldValue(fieldData, fieldMap.email);
  const platformValue = fieldValue(fieldData, fieldMap.platform) ?? platform;
  return {
    firstName: names.firstName,
    lastName: names.lastName,
    phone,
    email: email ? email.toLowerCase() : null,
    source: sourceFromPlatform(platformValue),
  };
}

function splitName(
  first: string | null,
  last: string | null,
  full: string | null,
): { firstName: string; lastName: string } | null {
  if (first && last) {
    return { firstName: first, lastName: last };
  }
  if (full) {
    const parts = full.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length >= 2) {
      return { firstName: first || parts[0], lastName: last || parts.slice(1).join(" ") };
    }
    if (parts.length === 1) {
      return { firstName: first || parts[0], lastName: last || parts[0] };
    }
  }
  if (first) {
    return { firstName: first, lastName: last || first };
  }
  return null;
}

function sourceFromPlatform(platform: string | undefined): LeadSource {
  const value = (platform ?? "").trim().toLowerCase();
  if (value === "ig" || value === "instagram") {
    return "Instagram";
  }
  return "Facebook";
}

function fieldValue(fieldData: MetaFieldData[], names: string[]): string | null {
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
  for (const field of fieldData) {
    if (!wanted.has(field.name.trim().toLowerCase())) {
      continue;
    }
    const value = field.values.map((item) => item.trim()).find((item) => item.length > 0);
    if (value) {
      return value;
    }
  }
  return null;
}

function leadgenItems(body: unknown): LeadgenItem[] {
  if (!body || typeof body !== "object" || (body as { object?: unknown }).object !== "page") {
    return [];
  }
  const entry = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) {
    return [];
  }
  const items: LeadgenItem[] = [];
  for (const row of entry) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const changes = (row as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) {
      continue;
    }
    for (const change of changes) {
      if (!change || typeof change !== "object" || (change as { field?: unknown }).field !== "leadgen") {
        continue;
      }
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object") {
        continue;
      }
      const leadgenId = (value as { leadgen_id?: unknown }).leadgen_id;
      if (typeof leadgenId !== "string" || !/^[0-9]+$/.test(leadgenId)) {
        continue;
      }
      const pageIdValue = (value as { page_id?: unknown }).page_id;
      const platformValue = (value as { platform?: unknown }).platform;
      const fieldDataValue = (value as { field_data?: unknown }).field_data;
      items.push({
        leadgenId,
        pageId: typeof pageIdValue === "string" ? pageIdValue : "",
        platform: typeof platformValue === "string" ? platformValue : undefined,
        fieldData: Array.isArray(fieldDataValue) ? fieldDataValue.flatMap(readField) : undefined,
      });
    }
  }
  return items;
}

function readField(value: unknown): MetaFieldData[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const name = (value as { name?: unknown }).name;
  const values = (value as { values?: unknown }).values;
  if (typeof name !== "string" || !Array.isArray(values)) {
    return [];
  }
  return [{ name, values: values.filter((item): item is string => typeof item === "string") }];
}

function isUniqueExternal(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
