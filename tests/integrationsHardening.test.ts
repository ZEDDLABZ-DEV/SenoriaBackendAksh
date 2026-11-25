import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationEnvKeys } from "../src/config";
import { setMetaLeadFetcher } from "../src/integrations/meta/graph";
import { setOutlookHttp } from "../src/integrations/outlook/http";
import { setRingCentralHttp } from "../src/integrations/ringcentral/http";
import { resetIntegrationWarnings } from "../src/integrations/status";
import { flushZohoSyncs } from "../src/integrations/zoho/sync";
import { setZohoHttp } from "../src/integrations/zoho/http";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();
const savedEnv = new Map<string, string | undefined>();
let nodeEnv: string | undefined;
const originalFetch = globalThis.fetch;
const vendorCalls: string[] = [];

beforeAll(() => {
  nodeEnv = process.env.NODE_ENV;
  for (const key of integrationEnvKeys()) {
    savedEnv.set(key, process.env[key]);
  }
});

beforeEach(async () => {
  await prepare();
  resetIntegrationWarnings();
  vendorCalls.length = 0;
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
  process.env.NODE_ENV = "test";
  const reject = async (url: string) => {
    vendorCalls.push(url);
    throw new Error("third-party HTTP is disabled");
  };
  setZohoHttp(async (url) => reject(url));
  setRingCentralHttp(async (url) => reject(url));
  setOutlookHttp(async (url) => reject(url));
  setMetaLeadFetcher(async (leadgenId) => {
    vendorCalls.push(`meta:${leadgenId}`);
    throw new Error("third-party HTTP is disabled");
  });
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    vendorCalls.push(url);
    throw new Error("third-party HTTP is disabled");
  }) as typeof fetch;
});

afterEach(() => {
  setZohoHttp(null);
  setRingCentralHttp(null);
  setOutlookHttp(null);
  setMetaLeadFetcher(null);
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  process.env.NODE_ENV = nodeEnv;
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreClock();
});

async function salesToken(role: "ADMIN" | "SALES") {
  const user = await createUser({
    role,
    email: `${role.toLowerCase()}@example.com`,
    firstName: role === "ADMIN" ? "Ada" : "Amy",
    lastName: role === "ADMIN" ? "Admin" : "Alpha",
  });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

async function salesWrites(token: string, ownerId: string) {
  const lead = await request(app).post("/api/v1/leads").set(auth(token)).send({
    firstName: "Maria",
    lastName: "Chen",
    phone: "416-555-0142",
    email: "maria.chen@email.com",
    source: "Phone",
    about: "Weekday mornings",
    ownerId,
  });
  expect(lead.status).toBe(201);
  const leadId = lead.body.data.id as string;

  const note = await request(app).post(`/api/v1/leads/${leadId}/notes`).set(auth(token)).send({
    outcome: "Connected",
    text: "Left a message",
  });
  expect(note.status).toBe(200);
  await flushZohoSyncs();

  const call = await request(app).post("/api/v1/calls").set(auth(token)).send({
    leadId,
    phone: "416-555-0142",
    direction: "Outbound",
    startedAt: "2026-11-19T20:14:00.000Z",
    endedAt: "2026-11-19T20:18:12.000Z",
    result: "Connected",
  });
  expect(call.status).toBe(201);

  const meeting = await request(app).post("/api/v1/sales/meetings").set(auth(token)).send({
    leadId,
    title: "Home visit",
    kind: "Visit",
    startAt: "2026-10-20T19:30:00.000Z",
    endAt: "2026-10-20T20:30:00.000Z",
  });
  expect(meeting.status).toBe(201);
  const meetingId = meeting.body.data.id as string;
  const renamed = await request(app)
    .patch(`/api/v1/sales/meetings/${meetingId}`)
    .set(auth(token))
    .send({ title: "Home assessment" });
  expect(renamed.status).toBe(200);

  const started = await request(app).post(`/api/v1/leads/${leadId}/calls/start`).set(auth(token));
  expect(started.status).toBe(200);
  expect(started.body.success).toBe(true);
  expect(started.body.data).toEqual({ started: false, reason: "ringcentral_not_configured" });

  const outlook = await request(app).post(`/api/v1/sales/meetings/${meetingId}/outlook`).set(auth(token));
  expect(outlook.status).toBe(200);
  expect(outlook.body.success).toBe(true);
  expect(outlook.body.data).toEqual({ synced: false, reason: "outlook_not_configured" });

  const removed = await request(app).delete(`/api/v1/sales/meetings/${meetingId}`).set(auth(token));
  expect(removed.status).toBe(200);

  const challenge = await request(app).get("/api/v1/webhooks/meta/leads").query({
    "hub.mode": "subscribe",
    "hub.verify_token": "smoke-challenge-token",
    "hub.challenge": "smoke-challenge",
  });
  expect(challenge.status).toBe(403);

  const metaPost = await request(app).post("/api/v1/webhooks/meta/leads").send({ object: "page", entry: [] });
  expect(metaPost.status).toBe(200);
  expect(metaPost.body).toEqual({ received: true, results: [] });

  const handshake = await request(app)
    .post("/api/v1/webhooks/ringcentral/calls")
    .set("Validation-Token", "smoke-validation")
    .send({});
  expect(handshake.status).toBe(200);
  expect(handshake.headers["validation-token"]).toBe("smoke-validation");

  const ringCentralPost = await request(app).post("/api/v1/webhooks/ringcentral/calls").send({
    body: { id: "should-not-store", direction: "Outbound", startTime: "2026-11-19T20:14:00.000Z" },
  });
  expect(ringCentralPost.status).toBe(200);
  expect(ringCentralPost.body).toEqual({ received: true, results: [] });

  const storedNote = await prisma.leadTimelineEvent.findFirstOrThrow({ where: { leadId, kind: "Note" } });
  expect(storedNote.text).toBe("Left a message");
  expect(storedNote.syncError).toBeNull();
  expect(storedNote.externalId).toBeNull();
  const storedMeeting = await prisma.salesMeeting.findUniqueOrThrow({ where: { id: meetingId } });
  expect(storedMeeting.title).toBe("Home assessment");
  expect(storedMeeting.deletedAt).toBeTruthy();
  expect(storedMeeting.externalId).toBeNull();
  expect(storedMeeting.syncError).toBeNull();
  process.env.ZOHO_WEBHOOK_SECRET = "hardening-zoho-secret";
  const zohoDenied = await request(app).post("/api/v1/webhooks/zoho/leads").send({
    id: "zcrm_82810000000332025",
    First_Name: "Amit",
    Last_Name: "Bishnoi",
    Phone: "9876543210",
  });
  expect(zohoDenied.status).toBe(403);
  const zohoIgnored = await request(app)
    .post("/api/v1/webhooks/zoho/leads")
    .set("X-Zoho-Webhook-Secret", "hardening-zoho-secret")
    .send({
      id: "zcrm_82810000000332025",
      First_Name: "Amit",
      Last_Name: "Bishnoi",
      Phone: "9876543210",
      Lead_Source: "Cold Call",
      Lead_Status: "Contact in Future",
      Description: "testing notes",
    });
  expect(zohoIgnored.status).toBe(200);
  expect(zohoIgnored.body).toEqual({ received: true, results: [] });

  expect(await prisma.salesCall.count()).toBe(1);
  expect(await prisma.lead.count()).toBe(1);
  expect(vendorCalls).toEqual([]);
}

describe("integration hardening", () => {
  it("keeps sales writes green and makes no third-party HTTP when every flag is false", async () => {
    const admin = await salesToken("ADMIN");
    const sales = await salesToken("SALES");
    const status = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(status.status).toBe(200);
    expect(status.body.data).toEqual({
      meta: { enabled: false, configured: false },
      ringcentral: { enabled: false, configured: false },
      zoho: { enabled: false, configured: false },
      outlook: { enabled: false, configured: false },
    });
    await salesWrites(admin.token, sales.user.id);
  });

  it("still makes no third-party HTTP when flags are true and credentials are missing", async () => {
    process.env.META_LEADS_ENABLED = "true";
    process.env.RINGCENTRAL_ENABLED = "true";
    process.env.ZOHO_ENABLED = "true";
    process.env.OUTLOOK_ENABLED = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const admin = await salesToken("ADMIN");
      const sales = await salesToken("SALES");
      const status = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
      expect(status.body.data).toEqual({
        meta: { enabled: false, configured: false },
        ringcentral: { enabled: false, configured: false },
        zoho: { enabled: false, configured: false },
        outlook: { enabled: false, configured: false },
      });
      await salesWrites(admin.token, sales.user.id);
      const warnings = warn.mock.calls.map((call) => String(call[0]));
      for (const name of ["meta", "ringcentral", "zoho", "outlook"]) {
        expect(warnings.filter((line) => line.includes(`"integration":"${name}"`) && line.includes("disabled"))).toHaveLength(1);
      }
    } finally {
      warn.mockRestore();
    }
  });
});
