import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logRingCentralCall } from "../../services/calls.service";
import { logIntegration } from "../log";
import { isIntegrationEnabled } from "../status";
import { fetchRecordingContentUri } from "./client";
import { readCallLogs, type ParsedCallLog } from "./cdr";

export type RingCentralIngestResult = {
  externalId: string;
  callId: string;
  leadId: string | null;
  created: boolean;
};

type LeadMatch = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  ownerId: string | null;
};

export async function ingestRingCentralCalls(payload: unknown): Promise<RingCentralIngestResult[]> {
  if (!isIntegrationEnabled("ringcentral")) {
    return [];
  }
  const results: RingCentralIngestResult[] = [];
  for (const item of readCallLogs(payload)) {
    if (!item.ok) {
      logIntegration("skipped", { integration: "ringcentral", externalId: item.externalId });
      continue;
    }
    try {
      results.push(await storeCallLog(item.call));
    } catch {
      logIntegration("failed", { integration: "ringcentral", externalId: item.call.externalId });
      throw new Error("RingCentral call log could not be stored");
    }
  }
  return results;
}

async function storeCallLog(call: ParsedCallLog): Promise<RingCentralIngestResult> {
  const existing = await prisma.salesCall.findFirst({
    where: { externalSource: "ringcentral", externalId: call.externalId },
    select: { id: true, leadId: true, recordingUrl: true },
  });
  if (existing?.recordingUrl) {
    logIntegration("succeeded", {
      integration: "ringcentral",
      externalId: call.externalId,
      callId: existing.id,
      leadId: existing.leadId,
    });
    return { externalId: call.externalId, callId: existing.id, leadId: existing.leadId, created: false };
  }
  const lead = await matchLeadByPhone(call.phone);
  const recording = await recordingFor(call);
  const stored = await logRingCentralCall({
    externalId: call.externalId,
    leadId: lead?.id ?? null,
    ownerId: lead?.ownerId ?? null,
    name: callName(lead, call.partyName),
    phone: lead?.phone ?? storedPhone(call.phone),
    direction: call.direction,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationSeconds: call.durationSeconds,
    result: call.result,
    recordingUrl: recording.url,
    syncError: recording.syncError,
  });
  const result = {
    externalId: call.externalId,
    callId: stored.id,
    leadId: stored.leadId,
    created: stored.created,
  };
  logIntegration("succeeded", {
    integration: "ringcentral",
    externalId: result.externalId,
    callId: result.callId,
    leadId: result.leadId,
  });
  return result;
}

async function recordingFor(call: ParsedCallLog): Promise<{ url: string | null; syncError: string | null }> {
  if (call.result !== "Connected") {
    return { url: null, syncError: null };
  }
  let url = call.recordingContentUri;
  if (!call.recordingId) {
    return { url, syncError: null };
  }
  const fetched = await fetchRecordingContentUri(call.recordingId);
  if (fetched.url) {
    return { url: fetched.url, syncError: null };
  }
  if (url) {
    return { url, syncError: null };
  }
  return { url: null, syncError: fetched.error ?? "RingCentral recording metadata request failed" };
}

/** Last 10 digits when the number has at least 10. The most recently updated lead wins. */
export async function matchLeadByPhone(phone: string): Promise<LeadMatch | null> {
  const key = phoneMatchKey(phone);
  if (!key) {
    return null;
  }
  const rows = await prisma.$queryRaw<LeadMatch[]>(Prisma.sql`
    SELECT id,
           first_name AS "firstName",
           last_name AS "lastName",
           phone,
           owner_id AS "ownerId"
    FROM leads
    WHERE CASE
      WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
        THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${key}
      ELSE regexp_replace(phone, '[^0-9]', '', 'g') = ${key}
    END
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

function phoneMatchKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function callName(lead: LeadMatch | null, partyName: string | null): string {
  if (lead) {
    const name = `${lead.firstName} ${lead.lastName}`.trim();
    if (name) {
      return name.slice(0, 120);
    }
  }
  if (partyName && partyName.trim()) {
    return partyName.trim().slice(0, 120);
  }
  return "Unknown caller";
}

function storedPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 40) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, "");
  const compact = trimmed.startsWith("+") ? `+${digits}` : digits;
  return compact.slice(0, 40);
}
