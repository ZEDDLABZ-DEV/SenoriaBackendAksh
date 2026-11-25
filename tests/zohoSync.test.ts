import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationEnvKeys } from "../src/config";
import { integrationAdapters } from "../src/integrations/adapters";
import { resetIntegrationWarnings } from "../src/integrations/status";
import { resetZohoAuthCache } from "../src/integrations/zoho/auth";
import { setZohoHttp, type ZohoHttp } from "../src/integrations/zoho/http";
import { enqueueZohoNoteSync, flushZohoSyncs } from "../src/integrations/zoho/sync";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();
const savedEnv = new Map<string, string | undefined>();

type Call = { method: string; url: string; body: string; authorization: string };
let calls: Call[] = [];
let notesStatus = 200;

const zohoHttp: ZohoHttp = async (url, init) => {
  calls.push({
    method: init.method,
    url,
    body: init.body ?? "",
    authorization: init.headers.Authorization ?? "",
  });
  if (url.endsWith("/oauth/v2/token")) {
    return json(200, { access_token: "zoho-access", expires_in: 3600 });
  }
  if (url.endsWith("/crm/v2/Leads/upsert")) {
    const parsed = JSON.parse(init.body ?? "{}") as { data: { id?: string }[] };
    const id = parsed.data[0]?.id ?? "555000";
    return json(200, { data: [{ status: "success", code: "SUCCESS", details: { id } }] });
  }
  if (url.endsWith("/crm/v2/Notes") && init.method === "POST") {
    if (notesStatus !== 200) {
      return json(notesStatus, {});
    }
    return json(200, { data: [{ status: "success", code: "SUCCESS", details: { id: "777000" } }] });
  }
  if (init.method === "PUT" && url.includes("/crm/v2/Notes/")) {
    return json(200, { data: [{ status: "success", code: "SUCCESS", details: { id: "777000" } }] });
  }
  return json(404, {});
};

beforeAll(() => {
  for (const key of integrationEnvKeys()) {
    savedEnv.set(key, process.env[key]);
  }
});

beforeEach(async () => {
  await prepare();
  resetIntegrationWarnings();
  resetZohoAuthCache();
  calls = [];
  notesStatus = 200;
  setZohoHttp(zohoHttp);
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
});

afterAll(() => {
  setZohoHttp(null);
  resetZohoAuthCache();
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreClock();
});

function enableZoho() {
  process.env.ZOHO_ENABLED = "true";
  process.env.ZOHO_CLIENT_ID = "zoho-client";
  process.env.ZOHO_CLIENT_SECRET = "zoho-secret";
  process.env.ZOHO_REFRESH_TOKEN = "zoho-refresh";
  process.env.ZOHO_ACCOUNTS_DOMAIN = "accounts.zoho.com";
  process.env.ZOHO_API_DOMAIN = "www.zohoapis.com";
}

async function tokenFor(role: "ADMIN" | "SALES") {
  const user = await createUser({ role, email: `${role.toLowerCase()}@example.com`, firstName: "Amy", lastName: "Alpha" });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

async function createLead(token: string) {
  const response = await request(app).post("/api/v1/leads").set(auth(token)).send({
    firstName: "Maria",
    lastName: "Chen",
    phone: "416-555-0142",
    email: "maria.chen@email.com",
    source: "Phone",
    about: "Weekday mornings",
  });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("zoho note sync", () => {
  it("saves a note with Zoho disabled and does not call Zoho", async () => {
    setZohoHttp(async () => {
      throw new Error("zoho should not be called");
    });
    const admin = await tokenFor("ADMIN");
    await createUser({ role: "SALES", email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await createLead(admin);
    const response = await request(app).post(`/api/v1/leads/${leadId}/notes`).set(auth(admin)).send({
      outcome: "Connected",
      text: "Daughter asked for pricing",
    });
    expect(response.status).toBe(200);
    expect(response.body.data.timeline.some((event: { text: string }) => event.text === "Daughter asked for pricing")).toBe(true);
    await flushZohoSyncs();
    const note = await prisma.leadTimelineEvent.findFirst({ where: { leadId, kind: "Note" } });
    expect(note?.externalId).toBeNull();
    expect(note?.syncError).toBeNull();
    expect(calls).toEqual([]);
  });

  it("upserts the lead, creates the note, and reuses those ids", async () => {
    enableZoho();
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
    const admin = await tokenFor("ADMIN");
    await createUser({ role: "SALES", email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await createLead(admin);
    const response = await request(app).post(`/api/v1/leads/${leadId}/notes`).set(auth(admin)).send({
      outcome: "Connected",
      text: "Daughter asked for pricing",
    });
    expect(response.status).toBe(200);
    await flushZohoSyncs();

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    const note = await prisma.leadTimelineEvent.findFirstOrThrow({ where: { leadId, kind: "Note" } });
    expect(lead?.zohoRecordId).toBe("555000");
    expect(lead?.externalSource).toBe("zoho");
    expect(lead?.externalId).toBe("555000");
    expect(lead?.syncError).toBeNull();
    expect(lead?.lastSyncedAt).toBeTruthy();
    expect(note.externalSource).toBe("zoho");
    expect(note.externalId).toBe("777000");
    expect(note.syncError).toBeNull();
    expect(note.text).toBe("Daughter asked for pricing");

    const upsert = calls.find((call) => call.url.endsWith("/crm/v2/Leads/upsert"));
    const createdNote = calls.find((call) => call.method === "POST" && call.url.endsWith("/crm/v2/Notes"));
    expect(JSON.parse(upsert?.body ?? "{}")).toMatchObject({
      data: [
        {
          First_Name: "Maria",
          Last_Name: "Chen",
          Phone: "416-555-0142",
          Email: "maria.chen@email.com",
          Company: "Senoria",
          Lead_Source: "Phone",
        },
      ],
      duplicate_check_fields: ["Phone"],
    });
    expect(JSON.parse(createdNote?.body ?? "{}").data[0]).toMatchObject({
      Note_Title: "Connected",
      Note_Content: "Daughter asked for pricing",
      Parent_Id: "555000",
      se_module: "Leads",
    });
    expect(upsert?.authorization).toBe("Zoho-oauthtoken zoho-access");
    expect(calls.filter((call) => call.url.endsWith("/oauth/v2/token"))).toHaveLength(1);

    calls = [];
    enqueueZohoNoteSync(leadId, note.id);
    await flushZohoSyncs();
    expect(calls.filter((call) => call.url.endsWith("/oauth/v2/token"))).toHaveLength(0);
    const again = calls.find((call) => call.url.endsWith("/crm/v2/Leads/upsert"));
    expect(JSON.parse(again?.body ?? "{}").data[0].id).toBe("555000");
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/crm/v2/Notes"))).toBe(false);
    expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/crm/v2/Notes/777000"))).toBe(true);
    expect(await prisma.leadTimelineEvent.count({ where: { leadId, kind: "Note" } })).toBe(1);
    const synced = info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("integration sync succeeded"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(synced).toHaveLength(2);
    expect(synced.every((line) => line.integration === "zoho" && line.success === true && line.externalId === "777000" && line.leadId === leadId && line.noteId === note.id)).toBe(true);
    expect(JSON.stringify(synced)).not.toContain("zoho-secret");
    expect(JSON.stringify(synced)).not.toContain("zoho-refresh");
    expect(JSON.stringify(synced)).not.toContain("zoho-access");
    } finally {
      info.mockRestore();
    }
  });

  it("keeps a Meta external id when the same lead is synced to Zoho", async () => {
    enableZoho();
    const admin = await tokenFor("ADMIN");
    await createUser({ role: "SALES", email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await createLead(admin);
    await prisma.lead.update({
      where: { id: leadId },
      data: { externalSource: "meta", externalId: "444555666777" },
    });
    const response = await request(app).post(`/api/v1/leads/${leadId}/notes`).set(auth(admin)).send({
      outcome: "No answer",
      text: "Left a voicemail",
    });
    expect(response.status).toBe(200);
    await flushZohoSyncs();
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.externalSource).toBe("meta");
    expect(lead?.externalId).toBe("444555666777");
    expect(lead?.zohoRecordId).toBe("555000");
  });

  it("keeps the Senoria note when Zoho returns 500 and stores syncError", async () => {
    enableZoho();
    notesStatus = 500;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
    const admin = await tokenFor("ADMIN");
    await createUser({ role: "SALES", email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await createLead(admin);
    const response = await request(app).post(`/api/v1/leads/${leadId}/notes`).set(auth(admin)).send({
      outcome: "Connected",
      text: "Daughter asked for pricing",
    });
    expect(response.status).toBe(200);
    expect(response.body.data.timeline.some((event: { text: string }) => event.text === "Daughter asked for pricing")).toBe(true);
    await flushZohoSyncs();
    const note = await prisma.leadTimelineEvent.findFirstOrThrow({ where: { leadId, kind: "Note" } });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(note.text).toBe("Daughter asked for pricing");
    expect(note.externalId).toBeNull();
    expect(note.syncError).toBe("Zoho request failed with status 500");
    expect(lead?.syncError).toBe("Zoho request failed with status 500");
    expect(lead?.zohoRecordId).toBe("555000");
    const failed = errors.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("integration sync failed"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(failed).toEqual([
      expect.objectContaining({ integration: "zoho", success: false, leadId, noteId: note.id }),
    ]);
    expect(JSON.stringify(failed)).not.toContain("zoho-secret");
    expect(JSON.stringify(failed)).not.toContain("zoho-refresh");
    expect(JSON.stringify(failed)).not.toContain("zoho-access");
    } finally {
      errors.mockRestore();
    }
  });

  it("reports zoho configured and enabled from the status endpoint", async () => {
    enableZoho();
    const admin = await tokenFor("ADMIN");
    const enabled = await request(app).get("/api/v1/integrations/status").set(auth(admin));
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.zoho).toEqual({ enabled: true, configured: true });
    expect(enabled.body.data.outlook).toEqual({ enabled: false, configured: false });

    process.env.ZOHO_ENABLED = "false";
    const flaggedOff = await request(app).get("/api/v1/integrations/status").set(auth(admin));
    expect(flaggedOff.body.data.zoho).toEqual({ enabled: false, configured: true });

    await expect(integrationAdapters.zoho.sync()).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});
