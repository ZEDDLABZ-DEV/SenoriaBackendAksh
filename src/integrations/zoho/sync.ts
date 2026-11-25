import { Prisma } from "@prisma/client";
import { integrationCredentialValues } from "../../config";
import { isIntegrationEnabled } from "../status";
import { externalSyncData } from "../externalSync";
import { logIntegration } from "../log";
import { now } from "../../lib/clock";
import { prisma } from "../../lib/prisma";
import { zohoAccessToken } from "./auth";
import { zohoHttp, zohoOrigin } from "./http";
import { zohoCrmModule } from "./module";

const pending = new Set<Promise<void>>();
const inFlight = new Set<string>();

export function flushZohoSyncs(): Promise<void> {
  return Promise.all([...pending]).then(() => undefined);
}

/** Schedules a Zoho push. Returns immediately. Disabled Zoho does not call Zoho. */
export function enqueueZohoNoteSync(leadId: string, noteId: string): void {
  try {
    if (!isIntegrationEnabled("zoho") || inFlight.has(noteId)) {
      return;
    }
    inFlight.add(noteId);
    const job = syncZohoNote(leadId, noteId)
      .catch((error: unknown) => {
        logIntegration("failed", { integration: "zoho", leadId, noteId });
        return recordFailure(leadId, noteId, error);
      })
      .finally(() => {
        inFlight.delete(noteId);
        pending.delete(job);
      });
    pending.add(job);
  } catch {
    logIntegration("failed", { integration: "zoho", leadId, noteId });
  }
}

export async function syncZohoNote(leadId: string, noteId: string): Promise<void> {
  if (!isIntegrationEnabled("zoho")) {
    return;
  }
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  const note = await prisma.leadTimelineEvent.findUnique({ where: { id: noteId } });
  if (!lead || !note || note.leadId !== lead.id || note.kind !== "Note") {
    return;
  }
  const moduleName = zohoCrmModule();
  const token = await zohoAccessToken();
  const api = zohoOrigin(integrationCredentialValues("zoho").ZOHO_API_DOMAIN);
  const existingLeadId = lead.zohoRecordId ?? (lead.externalSource === "zoho" ? lead.externalId : null);
  const recordId = await upsertLead(api, token, moduleName, lead, existingLeadId);
  const syncedAt = now();
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      zohoRecordId: recordId,
      ...(lead.externalSource ? { lastSyncedAt: syncedAt, syncError: null } : externalSyncData("zoho", recordId, syncedAt)),
    },
  });
  const existingNoteId = note.externalSource === "zoho" || note.externalSource === null ? note.externalId : null;
  const zohoNoteId = existingNoteId
    ? await updateNote(api, token, existingNoteId, note)
    : await createNote(api, token, moduleName, recordId, note);
  if (note.externalSource && note.externalSource !== "zoho") {
    await prisma.leadTimelineEvent.update({
      where: { id: note.id },
      data: { lastSyncedAt: syncedAt, syncError: null },
    });
    logIntegration("succeeded", { integration: "zoho", externalId: zohoNoteId, leadId: lead.id, noteId: note.id });
    return;
  }
  await prisma.leadTimelineEvent.update({
    where: { id: note.id },
    data: externalSyncData("zoho", zohoNoteId, syncedAt),
  });
  logIntegration("succeeded", { integration: "zoho", externalId: zohoNoteId, leadId: lead.id, noteId: note.id });
}

async function upsertLead(
  api: string,
  token: string,
  moduleName: "Leads" | "Contacts",
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    source: string;
    about: string;
  },
  existingId: string | null,
): Promise<string> {
  const record: Record<string, string> = {
    First_Name: lead.firstName,
    Last_Name: lead.lastName,
    Phone: lead.phone,
  };
  if (lead.email) {
    record.Email = lead.email;
  }
  const description = [lead.about.trim(), `Senoria lead ${lead.id}`].filter((part) => part.length > 0).join("\n");
  record.Description = description.slice(0, 2000);
  if (moduleName === "Leads") {
    record.Company = "Senoria";
    record.Lead_Source = lead.source;
  }
  if (existingId) {
    record.id = existingId;
  }
  const body: { data: Record<string, string>[]; duplicate_check_fields?: string[] } = { data: [record] };
  if (!existingId) {
    body.duplicate_check_fields = ["Phone"];
  }
  const response = await zohoHttp(`${api}/crm/v2/${moduleName}/upsert`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readRecordId(response);
}

async function createNote(
  api: string,
  token: string,
  moduleName: "Leads" | "Contacts",
  parentId: string,
  note: { text: string; meta: Prisma.JsonValue | null },
): Promise<string> {
  const response = await zohoHttp(`${api}/crm/v2/Notes`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        {
          Note_Title: noteTitle(note.meta),
          Note_Content: note.text.slice(0, 10_000),
          Parent_Id: parentId,
          se_module: moduleName,
        },
      ],
    }),
  });
  return readRecordId(response);
}

async function updateNote(
  api: string,
  token: string,
  noteId: string,
  note: { text: string; meta: Prisma.JsonValue | null },
): Promise<string> {
  const response = await zohoHttp(`${api}/crm/v2/Notes/${encodeURIComponent(noteId)}`, {
    method: "PUT",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        {
          Note_Title: noteTitle(note.meta),
          Note_Content: note.text.slice(0, 10_000),
        },
      ],
    }),
  });
  const id = await readRecordId(response);
  return id || noteId;
}

function noteTitle(meta: Prisma.JsonValue | null): string {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const outcome = (meta as { outcome?: unknown }).outcome;
    if (typeof outcome === "string" && outcome.trim()) {
      return outcome.trim().slice(0, 120);
    }
  }
  return "Note";
}

async function readRecordId(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Zoho request failed with status ${response.status}`);
  }
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Zoho response was not JSON");
  }
  const row = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
  const first = Array.isArray(row) ? row[0] : undefined;
  if (!first || typeof first !== "object") {
    throw new Error("Zoho response did not include a record");
  }
  const status = (first as { status?: unknown }).status;
  const details = (first as { details?: unknown }).details;
  const id = details && typeof details === "object" ? (details as { id?: unknown }).id : undefined;
  if (status !== "success" || typeof id !== "string" || id.trim() === "") {
    throw new Error("Zoho rejected the record");
  }
  return id;
}

async function recordFailure(leadId: string, noteId: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : "Zoho sync failed").slice(0, 500);
  await prisma.leadTimelineEvent.update({ where: { id: noteId }, data: { syncError: message } }).catch(() => undefined);
  await prisma.lead.update({ where: { id: leadId }, data: { syncError: message } }).catch(() => undefined);
}

