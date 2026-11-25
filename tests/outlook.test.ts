import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationCredentialValues, integrationEnvKeys } from "../src/config";
import { integrationAdapters } from "../src/integrations/adapters";
import { resetOutlookAuthCache } from "../src/integrations/outlook/auth";
import { setOutlookHttp, type OutlookHttp } from "../src/integrations/outlook/http";
import { resetIntegrationWarnings } from "../src/integrations/status";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();
const savedEnv = new Map<string, string | undefined>();

type Call = {
  method: string;
  url: string;
  body: string;
  authorization: string;
  contentType: string;
  prefer: string;
};

let calls: Call[] = [];
let nextId = 1;
let fail: { method: string; match: string; status: number } | null = null;
const missing = new Set<string>();

const outlookHttp: OutlookHttp = async (url, init) => {
  calls.push({
    method: init.method,
    url,
    body: init.body ?? "",
    authorization: init.headers.Authorization ?? "",
    contentType: init.headers["Content-Type"] ?? "",
    prefer: init.headers.Prefer ?? "",
  });
  if (url.includes("/oauth2/v2.0/token")) {
    return json(200, { access_token: "outlook-access", expires_in: 3600 });
  }
  if (fail && init.method === fail.method && url.includes(fail.match)) {
    return json(fail.status, {});
  }
  if (init.method === "POST" && /\/v1\.0\/users\/[^/]+\/events$/.test(url)) {
    return json(201, { id: `evt-${nextId++}` });
  }
  const match = url.match(/\/events\/([^/?]+)$/);
  if (!match) {
    return json(404, {});
  }
  const id = decodeURIComponent(match[1]);
  if (init.method === "PATCH") {
    if (missing.has(id)) {
      return json(404, {});
    }
    return json(200, { id });
  }
  if (init.method === "DELETE") {
    if (missing.has(id)) {
      return json(404, {});
    }
    return new Response(null, { status: 204 });
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
  resetOutlookAuthCache();
  calls = [];
  nextId = 1;
  fail = null;
  missing.clear();
  setOutlookHttp(outlookHttp);
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
});

afterAll(() => {
  setOutlookHttp(null);
  resetOutlookAuthCache();
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreClock();
});

function enableOutlook() {
  process.env.OUTLOOK_ENABLED = "true";
  process.env.OUTLOOK_CLIENT_ID = "outlook-client";
  process.env.OUTLOOK_CLIENT_SECRET = "outlook-secret";
  process.env.OUTLOOK_TENANT_ID = "11111111-1111-4111-8111-111111111111";
  process.env.OUTLOOK_CALENDAR_USER = "calendar@senoria.test";
}

async function tokenFor(role: "ADMIN" | "SALES", input: { email: string; firstName: string; lastName: string }) {
  const user = await createUser({ role, ...input });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

async function leadFor(adminToken: string, ownerId: string) {
  const lead = await request(app).post("/api/v1/leads").set(auth(adminToken)).send({
    firstName: "Helen",
    lastName: "Wright",
    phone: "604-555-0190",
    source: "Referral",
    ownerId,
  });
  expect(lead.status).toBe(201);
  return lead.body.data.id as string;
}

function meetingBody(leadId: string, title = "Home visit") {
  return {
    leadId,
    title,
    kind: "Visit",
    startAt: "2026-10-20T19:30:00.000Z",
    endAt: "2026-10-20T20:30:00.000Z",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("outlook calendar", () => {
  it("saves meetings with Outlook disabled and reports not_configured", async () => {
    setOutlookHttp(async () => {
      calls.push({ method: "GET", url: "called", body: "", authorization: "", contentType: "", prefer: "" });
      throw new Error("outlook should not be called");
    });
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });
    const leadId = await leadFor(admin.token, amy.user.id);

    const status = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(status.status).toBe(200);
    expect(status.body.data.outlook).toEqual({ enabled: false, configured: false });

    const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId));
    expect(created.status).toBe(201);
    expect(created.body.data.externalId).toBeUndefined();
    expect(created.body.data.syncError).toBeUndefined();
    const id = created.body.data.id as string;

    const renamed = await request(app)
      .patch(`/api/v1/sales/meetings/${id}`)
      .set(auth(amy.token))
      .send({ title: "Home assessment" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe("Home assessment");

    const removed = await request(app).delete(`/api/v1/sales/meetings/${id}`).set(auth(amy.token));
    expect(removed.status).toBe(200);

    const row = await prisma.salesMeeting.findUnique({ where: { id } });
    expect(row?.title).toBe("Home assessment");
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.externalSource).toBeNull();
    expect(row?.externalId).toBeNull();
    expect(row?.syncError).toBeNull();
    expect(calls).toEqual([]);

    const other = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId, "Second"));
    expect(other.status).toBe(201);
    const push = await request(app).post(`/api/v1/sales/meetings/${other.body.data.id}/outlook`).set(auth(amy.token));
    expect(push.status).toBe(200);
    expect(push.body.success).toBe(true);
    expect(push.body.data).toEqual({ synced: false, reason: "outlook_not_configured" });

    const missingMeeting = await request(app)
      .post("/api/v1/sales/meetings/00000000-0000-4000-8000-000000000099/outlook")
      .set(auth(admin.token));
    expect(missingMeeting.status).toBe(404);
    const forbidden = await request(app)
      .post(`/api/v1/sales/meetings/${other.body.data.id}/outlook`)
      .set(auth(bea.token));
    expect(forbidden.status).toBe(403);
    expect(calls).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.OUTLOOK_ENABLED = "true";
      process.env.OUTLOOK_CLIENT_ID = "outlook-client";
      process.env.OUTLOOK_CLIENT_SECRET = "outlook-secret";
      process.env.OUTLOOK_TENANT_ID = "11111111-1111-4111-8111-111111111111";
      const partial = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
      expect(partial.body.data.outlook).toEqual({ enabled: false, configured: false });
      const third = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId, "Third"));
      expect(third.status).toBe(201);
      const stillOff = await request(app)
        .post(`/api/v1/sales/meetings/${third.body.data.id}/outlook`)
        .set(auth(amy.token));
      expect(stillOff.body.data).toEqual({ synced: false, reason: "outlook_not_configured" });
      const stored = await prisma.salesMeeting.findUnique({ where: { id: third.body.data.id } });
      expect(stored?.externalId).toBeNull();
      expect(stored?.syncError).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("reports outlook configured from OUTLOOK_ or MICROSOFT_ names", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    enableOutlook();
    const enabled = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(enabled.body.data.outlook).toEqual({ enabled: true, configured: true });
    expect(enabled.body.data.meta).toEqual({ enabled: false, configured: false });
    expect(enabled.body.data.ringcentral).toEqual({ enabled: false, configured: false });
    expect(enabled.body.data.zoho).toEqual({ enabled: false, configured: false });

    process.env.OUTLOOK_ENABLED = "false";
    const flaggedOff = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(flaggedOff.body.data.outlook).toEqual({ enabled: false, configured: true });

    for (const key of ["OUTLOOK_ENABLED", "OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT_ID", "OUTLOOK_CALENDAR_USER"]) {
      delete process.env[key];
    }
    process.env.MICROSOFT_ENABLED = "true";
    process.env.MICROSOFT_CLIENT_ID = "ms-client";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
    process.env.MICROSOFT_TENANT_ID = "22222222-2222-4222-8222-222222222222";
    process.env.MICROSOFT_CALENDAR_USER = "calendar@senoria.test";
    const aliased = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(aliased.body.data.outlook).toEqual({ enabled: true, configured: true });
    expect(integrationCredentialValues("outlook").OUTLOOK_CLIENT_ID).toBe("ms-client");

    process.env.OUTLOOK_CLIENT_ID = "outlook-client";
    process.env.OUTLOOK_ENABLED = "false";
    process.env.MICROSOFT_ENABLED = "true";
    expect(integrationCredentialValues("outlook").OUTLOOK_CLIENT_ID).toBe("outlook-client");
    const outlookWins = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(outlookWins.body.data.outlook).toEqual({ enabled: false, configured: true });
  });

  it("creates, updates, and deletes an Outlook event and reuses externalId", async () => {
    enableOutlook();
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await leadFor(admin.token, amy.user.id);

    const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId));
    expect(created.status).toBe(201);
    expect(created.body.data.externalId).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toContain("outlook-secret");
    const id = created.body.data.id as string;
    const row = await prisma.salesMeeting.findUnique({ where: { id } });
    expect(row).toMatchObject({ externalSource: "outlook", externalId: "evt-1", syncError: null });
    expect(row?.lastSyncedAt).toBeTruthy();

    const tokenCall = calls.find((call) => call.url.endsWith("/oauth2/v2.0/token"));
    expect(tokenCall?.method).toBe("POST");
    expect(tokenCall?.url).toBe(
      "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token",
    );
    expect(tokenCall?.contentType).toBe("application/x-www-form-urlencoded");
    expect(tokenCall?.authorization).toBe("");
    const tokenBody = new URLSearchParams(tokenCall?.body ?? "");
    expect(tokenBody.get("grant_type")).toBe("client_credentials");
    expect(tokenBody.get("client_id")).toBe("outlook-client");
    expect(tokenBody.get("client_secret")).toBe("outlook-secret");
    expect(tokenBody.get("scope")).toBe("https://graph.microsoft.com/.default");

    const eventCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/events"));
    expect(eventCall?.url).toBe("https://graph.microsoft.com/v1.0/users/calendar%40senoria.test/events");
    expect(eventCall?.authorization).toBe("Bearer outlook-access");
    expect(eventCall?.prefer).toBe('outlook.timezone="UTC", IdType="ImmutableId"');
    expect(JSON.parse(eventCall?.body ?? "{}")).toEqual({
      subject: "Home visit",
      body: { contentType: "Text", content: `Visit with Helen Wright\nSenoria meeting ${id}` },
      start: { dateTime: "2026-10-20T19:30:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-10-20T20:30:00.0000000", timeZone: "UTC" },
      isReminderOn: false,
      transactionId: id,
    });
    expect(calls.filter((call) => call.url.endsWith("/oauth2/v2.0/token"))).toHaveLength(1);

    calls = [];
    const renamed = await request(app)
      .patch(`/api/v1/sales/meetings/${id}`)
      .set(auth(amy.token))
      .send({
        title: "Home assessment",
        startAt: "2026-10-21T15:00:00.123Z",
        endAt: "2026-10-21T16:00:00.123Z",
      });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe("Home assessment");
    expect(calls.map((call) => call.method)).toEqual(["PATCH"]);
    const patched = JSON.parse(calls[0]?.body ?? "{}");
    expect(patched.transactionId).toBeUndefined();
    expect(patched.subject).toBe("Home assessment");
    expect(patched.start).toEqual({ dateTime: "2026-10-21T15:00:00.1230000", timeZone: "UTC" });
    expect(patched.end).toEqual({ dateTime: "2026-10-21T16:00:00.1230000", timeZone: "UTC" });
    expect(calls[0]?.url).toBe("https://graph.microsoft.com/v1.0/users/calendar%40senoria.test/events/evt-1");
    expect((await prisma.salesMeeting.findUnique({ where: { id } }))?.externalId).toBe("evt-1");

    calls = [];
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const again = await request(app).post(`/api/v1/sales/meetings/${id}/outlook`).set(auth(admin.token));
    const synced = info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("integration sync succeeded"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    info.mockRestore();
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ synced: true, eventId: "evt-1" });
    expect(calls.map((call) => call.method)).toEqual(["PATCH"]);
    expect(synced).toEqual([
      expect.objectContaining({ integration: "outlook", success: true, externalId: "evt-1", meetingId: id }),
    ]);
    expect(JSON.stringify(synced)).not.toContain("outlook-secret");
    expect(JSON.stringify(synced)).not.toContain("outlook-access");
    expect(await prisma.salesMeeting.count({ where: { externalId: "evt-1" } })).toBe(1);

    calls = [];
    const note = await request(app).post(`/api/v1/leads/${leadId}/notes`).set(auth(amy.token)).send({
      outcome: "Booked",
      text: "Booked the intro call",
      followUpDate: "2026-10-22",
      followUpTime: "10:00",
    });
    expect(note.status).toBe(200);
    expect(calls).toEqual([]);

    calls = [];
    const removed = await request(app).delete(`/api/v1/sales/meetings/${id}`).set(auth(amy.token));
    expect(removed.status).toBe(200);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE https://graph.microsoft.com/v1.0/users/calendar%40senoria.test/events/evt-1",
    ]);
    const deleted = await prisma.salesMeeting.findUnique({ where: { id } });
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.externalId).toBe("evt-1");
    expect(deleted?.syncError).toBeNull();
    const listed = await request(app)
      .get("/api/v1/sales/meetings")
      .query({ from: "2026-10-21", to: "2026-10-21" })
      .set(auth(admin.token));
    expect(listed.body.data).toEqual([]);
  });

  it("uses MICROSOFT_ credentials when OUTLOOK_ values are empty", async () => {
    process.env.MICROSOFT_ENABLED = "true";
    process.env.MICROSOFT_CLIENT_ID = "ms-client";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
    process.env.MICROSOFT_TENANT_ID = "22222222-2222-4222-8222-222222222222";
    process.env.MICROSOFT_CALENDAR_USER = "calendar@contoso.test";
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await leadFor(admin.token, amy.user.id);
    const created = await request(app).post("/api/v1/sales/meetings").set(auth(admin.token)).send(meetingBody(leadId));
    expect(created.status).toBe(201);
    expect((await prisma.salesMeeting.findUnique({ where: { id: created.body.data.id } }))?.externalId).toBe("evt-1");
    const tokenCall = calls.find((call) => call.url.endsWith("/oauth2/v2.0/token"));
    expect(tokenCall?.url).toBe(
      "https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/oauth2/v2.0/token",
    );
    expect(new URLSearchParams(tokenCall?.body ?? "").get("client_id")).toBe("ms-client");
    expect(calls.some((call) => call.url.includes("/users/calendar%40contoso.test/events"))).toBe(true);
  });

  it("keeps the Senoria meeting when Graph fails and stores syncError", async () => {
    enableOutlook();
    fail = { method: "POST", match: "/events", status: 500 };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
      const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
      const leadId = await leadFor(admin.token, amy.user.id);
      const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId));
      expect(created.status).toBe(201);
      expect(created.body.data.title).toBe("Home visit");
      const id = created.body.data.id as string;
      const row = await prisma.salesMeeting.findUnique({ where: { id } });
      expect(row?.externalId).toBeNull();
      expect(row?.externalSource).toBeNull();
      expect(row?.syncError).toBe("Outlook request failed with status 500");
      const logged = errors.mock.calls.map((entry) => String(entry[0])).join("\n");
      const failure = errors.mock.calls
        .map((entry) => String(entry[0]))
        .find((line) => line.includes("integration sync failed"));
      expect(JSON.parse(failure ?? "{}")).toMatchObject({ integration: "outlook", success: false, meetingId: id });
      expect(logged).not.toContain("outlook-secret");
      expect(logged).not.toContain("outlook-access");

      const pushed = await request(app).post(`/api/v1/sales/meetings/${id}/outlook`).set(auth(amy.token));
      expect(pushed.status).toBe(200);
      expect(pushed.body.success).toBe(true);
      expect(pushed.body.data).toEqual({ synced: false, reason: "outlook_sync_failed" });
      expect((await prisma.salesMeeting.findUnique({ where: { id } }))?.title).toBe("Home visit");

      fail = null;
      calls = [];
      const recovered = await request(app).post(`/api/v1/sales/meetings/${id}/outlook`).set(auth(amy.token));
      expect(recovered.status).toBe(200);
      expect(recovered.body.data).toEqual({ synced: true, eventId: "evt-1" });
      expect(await prisma.salesMeeting.findUnique({ where: { id } })).toMatchObject({
        externalId: "evt-1",
        syncError: null,
      });

      fail = { method: "PATCH", match: "/events/", status: 500 };
      const renamed = await request(app).patch(`/api/v1/sales/meetings/${id}`).set(auth(amy.token)).send({
        title: "Still on the calendar",
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.title).toBe("Still on the calendar");
      expect(await prisma.salesMeeting.findUnique({ where: { id } })).toMatchObject({
        title: "Still on the calendar",
        externalId: "evt-1",
        syncError: "Outlook request failed with status 500",
      });

      fail = { method: "DELETE", match: "/events/", status: 500 };
      const removed = await request(app).delete(`/api/v1/sales/meetings/${id}`).set(auth(amy.token));
      expect(removed.status).toBe(200);
      const deleted = await prisma.salesMeeting.findUnique({ where: { id } });
      expect(deleted?.deletedAt).toBeTruthy();
      expect(deleted?.externalId).toBe("evt-1");
      expect(deleted?.syncError).toBe("Outlook request failed with status 500");
      const listed = await request(app)
        .get("/api/v1/sales/meetings")
        .query({ from: "2026-10-20", to: "2026-10-20" })
        .set(auth(admin.token));
      expect(listed.body.data).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("does not store a transport error message and does not call Graph for a bad mailbox or tenant", async () => {
    enableOutlook();
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await leadFor(admin.token, amy.user.id);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setOutlookHttp(async () => {
      throw new Error("socket hang up outlook-secret");
    });
    try {
      const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId));
      expect(created.status).toBe(201);
      const row = await prisma.salesMeeting.findUnique({ where: { id: created.body.data.id } });
      expect(row?.syncError).toBe("Outlook request failed");
      expect(row?.externalId).toBeNull();
      expect(errors.mock.calls.map((entry) => String(entry[0])).join("\n")).not.toContain("outlook-secret");
    } finally {
      errors.mockRestore();
      setOutlookHttp(outlookHttp);
    }

    calls = [];
    process.env.OUTLOOK_CALENDAR_USER = "not a mailbox";
    const badMailbox = await request(app)
      .post("/api/v1/sales/meetings")
      .set(auth(amy.token))
      .send(meetingBody(leadId, "Bad mailbox"));
    expect(badMailbox.status).toBe(201);
    expect((await prisma.salesMeeting.findUnique({ where: { id: badMailbox.body.data.id } }))?.syncError).toBe(
      "Outlook calendar user is not a mailbox UPN",
    );
    expect(calls).toEqual([]);

    calls = [];
    process.env.OUTLOOK_CALENDAR_USER = "calendar@senoria.test";
    process.env.OUTLOOK_TENANT_ID = "../evil";
    const badTenant = await request(app)
      .post("/api/v1/sales/meetings")
      .set(auth(amy.token))
      .send(meetingBody(leadId, "Bad tenant"));
    expect(badTenant.status).toBe(201);
    expect((await prisma.salesMeeting.findUnique({ where: { id: badTenant.body.data.id } }))?.syncError).toBe(
      "Outlook tenant id is not valid",
    );
    expect(calls).toEqual([]);
  });

  it("creates a replacement when the Outlook event is gone and treats delete 404 as success", async () => {
    enableOutlook();
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await leadFor(admin.token, amy.user.id);
    const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId));
    const id = created.body.data.id as string;
    missing.add("evt-1");
    calls = [];
    const renamed = await request(app).patch(`/api/v1/sales/meetings/${id}`).set(auth(amy.token)).send({
      title: "Moved",
    });
    expect(renamed.status).toBe(200);
    expect(calls.map((call) => call.method)).toEqual(["PATCH", "POST"]);
    expect((await prisma.salesMeeting.findUnique({ where: { id } }))?.externalId).toBe("evt-2");

    missing.add("evt-2");
    calls = [];
    const removed = await request(app).delete(`/api/v1/sales/meetings/${id}`).set(auth(amy.token));
    expect(removed.status).toBe(200);
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
    const row = await prisma.salesMeeting.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.externalId).toBe("evt-2");
    expect(row?.syncError).toBeNull();
  });

  it("does not call Graph on edit or delete until an event id exists", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const leadId = await leadFor(admin.token, amy.user.id);
    const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId));
    const id = created.body.data.id as string;
    enableOutlook();
    calls = [];
    const renamed = await request(app).patch(`/api/v1/sales/meetings/${id}`).set(auth(amy.token)).send({
      title: "Local only",
    });
    expect(renamed.status).toBe(200);
    expect(calls).toEqual([]);
    expect((await prisma.salesMeeting.findUnique({ where: { id } }))?.externalId).toBeNull();

    const pushed = await request(app).post(`/api/v1/sales/meetings/${id}/outlook`).set(auth(amy.token));
    expect(pushed.body.data).toEqual({ synced: true, eventId: "evt-1" });
    expect(calls.filter((call) => call.method === "POST" && call.url.endsWith("/events"))).toHaveLength(1);

    const other = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send(meetingBody(leadId, "Keep"));
    expect(other.status).toBe(201);
    await prisma.salesMeeting.update({
      where: { id: other.body.data.id },
      data: { externalSource: null, externalId: null, syncError: null, lastSyncedAt: null },
    });
    calls = [];
    const removed = await request(app).delete(`/api/v1/sales/meetings/${other.body.data.id}`).set(auth(amy.token));
    expect(removed.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("does not call Graph from the adapter sync method", async () => {
    enableOutlook();
    setOutlookHttp(async () => {
      throw new Error("outlook should not be called");
    });
    await expect(integrationAdapters.outlook.sync()).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});
