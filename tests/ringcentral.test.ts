import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationEnvKeys } from "../src/config";
import { resetRingCentralAuthCache } from "../src/integrations/ringcentral/auth";
import { setRingCentralHttp, type RingCentralHttp } from "../src/integrations/ringcentral/http";
import { resetIntegrationWarnings } from "../src/integrations/status";
import { prisma } from "../src/lib/prisma";
import { CLOCK, PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();
const connected = JSON.parse(readFileSync("tests/fixtures/ringcentral/call-log-connected.json", "utf8"));
const missed = JSON.parse(readFileSync("tests/fixtures/ringcentral/call-log-missed-inbound.json", "utf8"));

const savedEnv = new Map<string, string | undefined>();
let nodeEnv: string | undefined;
const httpCalls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
let recordingStatus = 200;
let ringOutStatus = 200;

beforeAll(() => {
  nodeEnv = process.env.NODE_ENV;
  for (const key of integrationEnvKeys()) {
    savedEnv.set(key, process.env[key]);
  }
});

beforeEach(async () => {
  await prepare();
  resetIntegrationWarnings();
  resetRingCentralAuthCache();
  httpCalls.length = 0;
  recordingStatus = 200;
  ringOutStatus = 200;
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
  process.env.NODE_ENV = nodeEnv;
  setRingCentralHttp(mockRingCentral);
});

afterAll(() => {
  setRingCentralHttp(null);
  resetRingCentralAuthCache();
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

const mockRingCentral: RingCentralHttp = async (url, init) => {
  httpCalls.push({ url, method: init.method, headers: init.headers, body: init.body });
  if (url.endsWith("/restapi/oauth/token")) {
    return jsonResponse(200, { access_token: "rc-access-token", token_type: "bearer", expires_in: 3600 });
  }
  if (url.includes("/ring-out")) {
    if (ringOutStatus !== 200) {
      return jsonResponse(ringOutStatus, { message: "ring-out rejected" });
    }
    return jsonResponse(200, {
      id: "255",
      uri: "https://platform.devtest.ringcentral.com/restapi/v1.0/account/111/extension/222/ring-out/255",
      status: { callStatus: "InProgress", callerStatus: "InProgress", calleeStatus: "InProgress" },
    });
  }
  if (url.includes("/recording/")) {
    if (recordingStatus !== 200) {
      return jsonResponse(recordingStatus, { message: "recording unavailable" });
    }
    const id = url.split("/recording/")[1]?.split("?")[0] ?? "recording";
    return jsonResponse(200, {
      id,
      contentUri: `https://media.example.test/recording/${id}?from=metadata`,
    });
  }
  return jsonResponse(500, { message: "unexpected" });
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function enableRingCentral() {
  process.env.RINGCENTRAL_ENABLED = "true";
  process.env.RINGCENTRAL_CLIENT_ID = "rc-client";
  process.env.RINGCENTRAL_CLIENT_SECRET = "rc-client-secret";
  process.env.RINGCENTRAL_SERVER_URL = "https://platform.devtest.ringcentral.com";
  process.env.RINGCENTRAL_JWT = "rc-jwt-value";
  process.env.RINGCENTRAL_ACCOUNT_ID = "111";
  process.env.RINGCENTRAL_EXTENSION_ID = "222";
  process.env.RINGCENTRAL_FROM_NUMBER = "+14165550100";
  process.env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN = "rc-webhook-token";
}

async function tokenFor(role: "ADMIN" | "SALES", input: { email: string; firstName: string; lastName: string }) {
  const user = await createUser({ role, ...input });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

function postWebhook(body: object = connected, token = process.env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN) {
  const req = request(app).post("/api/v1/webhooks/ringcentral/calls").send(body);
  if (token) {
    req.set("Verification-Token", token);
  }
  return req;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("ringcentral", () => {
  it("reports configured only when every required value is set, and enabled only with the flag", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    enableRingCentral();
    process.env.RINGCENTRAL_ENABLED = "false";

    const configured = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(configured.status).toBe(200);
    expect(configured.body.data.ringcentral).toEqual({ enabled: false, configured: true });
    expect(configured.body.data.outlook).toEqual({ enabled: false, configured: false });
    expect(JSON.stringify(configured.body)).not.toContain("rc-client-secret");
    expect(JSON.stringify(configured.body)).not.toContain("rc-jwt-value");

    process.env.RINGCENTRAL_ENABLED = "true";
    const enabled = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(enabled.body.data.ringcentral).toEqual({ enabled: true, configured: true });

    delete process.env.RINGCENTRAL_FROM_NUMBER;
    const partial = await request(app).get("/api/v1/integrations/status").set(auth(admin.token));
    expect(partial.body.data.ringcentral).toEqual({ enabled: false, configured: false });
  });

  it("returns not_configured and does not call RingCentral when dialing is off", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Phone",
      ownerId: amy.user.id,
    });
    expect(lead.status).toBe(201);

    const disabled = await request(app).post(`/api/v1/leads/${lead.body.data.id}/calls/start`).set(auth(amy.token));
    expect(disabled.status).toBe(200);
    expect(disabled.body.success).toBe(true);
    expect(disabled.body.data).toEqual({ started: false, reason: "ringcentral_not_configured" });

    process.env.RINGCENTRAL_ENABLED = "true";
    process.env.RINGCENTRAL_CLIENT_ID = "rc-client";
    process.env.RINGCENTRAL_CLIENT_SECRET = "rc-client-secret";
    process.env.RINGCENTRAL_SERVER_URL = "https://platform.devtest.ringcentral.com";
    process.env.RINGCENTRAL_JWT = "rc-jwt-value";
    const partial = await request(app).post(`/api/v1/leads/${lead.body.data.id}/calls/start`).set(auth(amy.token));
    expect(partial.status).toBe(200);
    expect(partial.body.data).toEqual({ started: false, reason: "ringcentral_not_configured" });
    expect(httpCalls).toEqual([]);
    expect(await prisma.salesCall.count()).toBe(0);
  });

  it("starts a RingOut call for an admin or the owning salesperson", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });
    enableRingCentral();
    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Phone",
      ownerId: amy.user.id,
    });
    expect(lead.status).toBe(201);

    const missing = await request(app)
      .post("/api/v1/leads/00000000-0000-4000-8000-000000000099/calls/start")
      .set(auth(admin.token));
    expect(missing.status).toBe(404);

    const forbidden = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/calls/start`)
      .set(auth(bea.token));
    expect(forbidden.status).toBe(403);
    expect(httpCalls).toEqual([]);

    const started = await request(app).post(`/api/v1/leads/${lead.body.data.id}/calls/start`).set(auth(amy.token));
    expect(started.status).toBe(200);
    expect(started.body.data).toEqual({ started: true, callId: "255", sessionId: "255", status: "started" });
    expect(JSON.stringify(started.body)).not.toContain("rc-jwt-value");
    expect(JSON.stringify(started.body)).not.toContain("rc-client-secret");
    expect(await prisma.salesCall.count()).toBe(0);

    const tokenCall = httpCalls.find((call) => call.url.endsWith("/restapi/oauth/token"));
    expect(tokenCall?.method).toBe("POST");
    expect(tokenCall?.headers.Authorization).toBe(
      `Basic ${Buffer.from("rc-client:rc-client-secret").toString("base64")}`,
    );
    expect(tokenCall?.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(tokenCall?.body).toContain("assertion=rc-jwt-value");

    const dial = httpCalls.find((call) => call.url.includes("/ring-out"));
    expect(dial?.url).toBe(
      "https://platform.devtest.ringcentral.com/restapi/v1.0/account/111/extension/222/ring-out",
    );
    expect(dial?.headers.Authorization).toBe("Bearer rc-access-token");
    expect(JSON.parse(dial?.body ?? "{}")).toEqual({
      from: { phoneNumber: "+14165550100" },
      to: { phoneNumber: "+14165550142" },
      playPrompt: false,
    });

    const again = await request(app).post(`/api/v1/leads/${lead.body.data.id}/calls/start`).set(auth(admin.token));
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("started");

    process.env.RINGCENTRAL_SERVER_URL = "https://user:rc-url-secret@platform.devtest.ringcentral.com";
    resetRingCentralAuthCache();
    const before = httpCalls.length;
    const rejected = await request(app).post(`/api/v1/leads/${lead.body.data.id}/calls/start`).set(auth(amy.token));
    expect(rejected.status).toBe(502);
    expect(rejected.body.code).toBe("RINGCENTRAL_UNAVAILABLE");
    expect(JSON.stringify(rejected.body)).not.toContain("rc-url-secret");
    expect(httpCalls).toHaveLength(before);

    process.env.RINGCENTRAL_SERVER_URL = "https://platform.devtest.ringcentral.com";
    resetRingCentralAuthCache();
    ringOutStatus = 400;
    const failed = await request(app).post(`/api/v1/leads/${lead.body.data.id}/calls/start`).set(auth(amy.token));
    expect(failed.status).toBe(502);
    expect(await prisma.salesCall.count()).toBe(0);
    const lines = [...info.mock.calls, ...errors.mock.calls]
      .map((call) => String(call[0]))
      .filter((line) => line.includes("integration sync"));
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      integration: "ringcentral",
      success: true,
      externalId: "255",
      leadId: lead.body.data.id,
      callId: "255",
    });
    expect(lines.filter((line) => line.includes("\"success\":false")).length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("rc-jwt-value");
    expect(lines.join("\n")).not.toContain("rc-client-secret");
    expect(lines.join("\n")).not.toContain("rc-access-token");
    } finally {
      info.mockRestore();
      errors.mockRestore();
    }
  });

  it("logs a connected call from a CDR, stores recording metadata, and ignores a duplicate", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });
    enableRingCentral();
    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Phone",
      ownerId: amy.user.id,
    });

    const first = await postWebhook();
    expect(first.status).toBe(200);
    expect(first.body.results).toEqual([
      { externalId: "s-connected-1", callId: expect.any(String), leadId: lead.body.data.id, created: true },
    ]);

    const detail = await request(app).get(`/api/v1/calls/${first.body.results[0].callId}`).set(auth(amy.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      leadId: lead.body.data.id,
      name: "Maria Chen",
      phone: "416-555-0142",
      direction: "Outbound",
      result: "Connected",
      durationSeconds: 252,
      durationLabel: "4 min 12 sec",
      startedAt: "2026-11-19T20:14:00.000Z",
      endedAt: "2026-11-19T20:18:12.000Z",
      recordingAvailable: true,
      recordingUrl: "https://media.example.test/recording/rec-connected-1?from=metadata",
      ownerId: amy.user.id,
    });
    const leadDetail = await request(app).get(`/api/v1/leads/${lead.body.data.id}`).set(auth(amy.token));
    expect(leadDetail.body.data.lastTouchAt).toBe(CLOCK);
    expect(leadDetail.body.data.timeline.at(-1)).toMatchObject({
      kind: "Call",
      text: "Outbound call, Connected.",
      actorId: null,
    });
    const row = await prisma.salesCall.findUnique({ where: { id: first.body.results[0].callId } });
    expect(row).toMatchObject({ externalSource: "ringcentral", externalId: "s-connected-1", syncError: null });
    const storedLead = await prisma.lead.findUnique({ where: { id: lead.body.data.id } });
    expect(storedLead?.externalSource).toBeNull();

    const recording = httpCalls.find((call) => call.url.includes("/recording/rec-connected-1"));
    expect(recording?.url).toBe(
      "https://platform.devtest.ringcentral.com/restapi/v1.0/account/111/recording/rec-connected-1",
    );
    expect(recording?.headers.Authorization).toBe("Bearer rc-access-token");

    const hidden = await request(app).get(`/api/v1/calls/${first.body.results[0].callId}`).set(auth(bea.token));
    expect(hidden.status).toBe(403);

    const beforeReplay = httpCalls.length;
    const second = await postWebhook();
    expect(second.status).toBe(200);
    expect(second.body.results[0]).toMatchObject({ callId: first.body.results[0].callId, created: false });
    expect(httpCalls).toHaveLength(beforeReplay);
    expect(await prisma.salesCall.count()).toBe(1);
    expect(await prisma.leadTimelineEvent.count({ where: { leadId: lead.body.data.id, kind: "Call" } })).toBe(1);
  });

  it("stores an unmatched inbound with a null lead and keeps a call when recording metadata fails", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });
    enableRingCentral();

    const inbound = await postWebhook(missed);
    expect(inbound.status).toBe(200);
    expect(inbound.body.results[0]).toMatchObject({ externalId: "s-missed-1", leadId: null, created: true });
    const missedRow = await prisma.salesCall.findUnique({ where: { id: inbound.body.results[0].callId } });
    expect(missedRow).toMatchObject({
      leadId: null,
      ownerId: null,
      name: "Unknown caller",
      phone: "+14375550164",
      direction: "Inbound",
      result: "Missed",
      durationSeconds: 0,
      recordingUrl: null,
    });
    expect(missedRow?.endedAt?.toISOString()).toBe("2026-11-19T21:00:00.000Z");
    const visible = await request(app).get("/api/v1/calls").set(auth(bea.token));
    expect(visible.body.data.data.map((call: { id: string }) => call.id)).toEqual([inbound.body.results[0].callId]);
    expect(await prisma.leadTimelineEvent.count()).toBe(0);

    recordingStatus = 500;
    const failed = clone(connected);
    failed.body.telephonySessionId = "s-no-recording";
    failed.body.sessionId = "s-no-recording";
    failed.body.id = "s-no-recording";
    delete failed.body.recording.contentUri;
    const kept = await postWebhook(failed);
    expect(kept.status).toBe(200);
    expect(kept.body.results[0].created).toBe(true);
    const failedRow = await prisma.salesCall.findUnique({ where: { id: kept.body.results[0].callId } });
    expect(failedRow).toMatchObject({
      result: "Connected",
      recordingUrl: null,
      syncError: "RingCentral recording metadata request failed with status 500",
    });
    expect(failedRow?.leadId).toBeNull();

    recordingStatus = 200;
    const retry = await postWebhook(failed);
    expect(retry.body.results[0]).toMatchObject({ callId: kept.body.results[0].callId, created: false });
    const filled = await prisma.salesCall.findUnique({ where: { id: kept.body.results[0].callId } });
    expect(filled?.recordingUrl).toBe("https://media.example.test/recording/rec-connected-1?from=metadata");
    expect(filled?.syncError).toBeNull();
    expect(await prisma.salesCall.count({ where: { externalId: "s-no-recording" } })).toBe(1);

    recordingStatus = 500;
    const fallback = clone(connected);
    fallback.body.telephonySessionId = "s-fallback";
    fallback.body.sessionId = "s-fallback";
    fallback.body.id = "s-fallback";
    const saved = await postWebhook(fallback);
    const fallbackRow = await prisma.salesCall.findUnique({ where: { id: saved.body.results[0].callId } });
    expect(fallbackRow).toMatchObject({
      recordingUrl: "https://media.example.test/recording/rec-connected-1/content",
      syncError: null,
    });
  });

  it("matches the most recently updated lead and maps voicemail, no answer, and hang up", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });
    enableRingCentral();
    const older = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Older",
      lastName: "Lead",
      phone: "416-555-0199",
      source: "Phone",
      ownerId: amy.user.id,
    });
    const newer = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Newer",
      lastName: "Lead",
      phone: "+1 (416) 555-0199",
      source: "Referral",
      ownerId: bea.user.id,
    });
    await request(app).patch(`/api/v1/leads/${newer.body.data.id}`).set(auth(admin.token)).send({ about: "newer" });

    const shared = clone(connected);
    shared.body.telephonySessionId = "s-newer";
    shared.body.to.phoneNumber = "+14165550199";
    delete shared.body.recording;
    const first = await postWebhook(shared);
    expect(first.body.results[0].leadId).toBe(newer.body.data.id);

    await request(app).patch(`/api/v1/leads/${older.body.data.id}`).set(auth(admin.token)).send({ about: "now older is newer" });
    shared.body.telephonySessionId = "s-older";
    const second = await postWebhook(shared);
    expect(second.body.results[0].leadId).toBe(older.body.data.id);

    const voicemail = clone(missed);
    voicemail.body.telephonySessionId = "s-voicemail";
    voicemail.body.result = "Voicemail";
    voicemail.body.from.phoneNumber = "416-555-0199";
    const voice = await postWebhook(voicemail);
    expect(voice.body.results[0].leadId).toBe(older.body.data.id);
    const voiceRow = await prisma.salesCall.findUnique({ where: { id: voice.body.results[0].callId } });
    expect(voiceRow?.result).toBe("Voicemail");

    const noAnswer = clone(connected);
    noAnswer.body.telephonySessionId = "s-no-answer";
    noAnswer.body.result = "No Answer";
    noAnswer.body.duration = 0;
    delete noAnswer.body.recording;
    const unanswered = await postWebhook(noAnswer);
    const unansweredRow = await prisma.salesCall.findUnique({ where: { id: unanswered.body.results[0].callId } });
    expect(unansweredRow).toMatchObject({ result: "No answer", durationSeconds: 0, leadId: null });

    const hungUp = clone(connected);
    hungUp.body.telephonySessionId = "s-hangup";
    hungUp.body.result = "Hang Up";
    hungUp.body.duration = 12;
    delete hungUp.body.recording;
    const hang = await postWebhook(hungUp);
    const hangRow = await prisma.salesCall.findUnique({ where: { id: hang.body.results[0].callId } });
    expect(hangRow?.result).toBe("Connected");
    expect(hangRow?.durationSeconds).toBe(12);
    expect(httpCalls.filter((call) => call.url.includes("/recording/"))).toEqual([]);
  });

  it("acks a disabled webhook, a handshake, and records that are not call logs", async () => {
    const ignored = await postWebhook(connected, "");
    expect(ignored.status).toBe(200);
    expect(ignored.body).toEqual({ received: true, results: [] });
    expect(await prisma.salesCall.count()).toBe(0);
    expect(httpCalls).toEqual([]);

    enableRingCentral();
    process.env.RINGCENTRAL_ENABLED = "false";
    const disabled = await postWebhook();
    expect(disabled.body).toEqual({ received: true, results: [] });
    expect(await prisma.salesCall.count()).toBe(0);

    process.env.RINGCENTRAL_ENABLED = "true";
    const wrong = await postWebhook(connected, "wrong-token");
    expect(wrong.status).toBe(403);
    expect(await prisma.salesCall.count()).toBe(0);

    const handshake = await request(app)
      .post("/api/v1/webhooks/ringcentral/calls")
      .set("Verification-Token", "rc-webhook-token")
      .set("Validation-Token", "handshake-token")
      .send(connected);
    expect(handshake.status).toBe(200);
    expect(handshake.headers["validation-token"]).toBe("handshake-token");
    expect(await prisma.salesCall.count()).toBe(0);

    const sms = clone(connected);
    sms.body.type = "SMS";
    sms.body.telephonySessionId = "s-sms";
    const text = await postWebhook(sms);
    expect(text.body.results).toEqual([]);

    const progress = await postWebhook({
      body: { telephonySessionId: "s-progress", parties: [{ direction: "Outbound", status: { code: "Setup" } }] },
    });
    expect(progress.body.results).toEqual([]);
    expect(await prisma.salesCall.count()).toBe(0);

    process.env.NODE_ENV = "production";
    delete process.env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN;
    const production = await postWebhook(connected, "");
    expect(production.status).toBe(403);
  });

  it("still logs a manual call without dialing", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    enableRingCentral();
    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Phone",
      ownerId: amy.user.id,
    });
    const logged = await request(app).post("/api/v1/calls").set(auth(amy.token)).send({
      leadId: lead.body.data.id,
      phone: "416-555-0142",
      direction: "Outbound",
      startedAt: "2026-11-19T20:14:00.000Z",
      endedAt: "2026-11-19T20:18:12.000Z",
      result: "Connected",
    });
    expect(logged.status).toBe(201);
    expect(logged.body.data).toMatchObject({
      leadId: lead.body.data.id,
      name: "Maria Chen",
      result: "Connected",
      recordingAvailable: false,
      recordingUrl: null,
    });
    expect(logged.body.data.externalSource).toBeUndefined();
    const row = await prisma.salesCall.findUnique({ where: { id: logged.body.data.id } });
    expect(row?.externalSource).toBeNull();
    expect(row?.externalId).toBeNull();
    expect(httpCalls).toEqual([]);
    const detail = await request(app).get(`/api/v1/leads/${lead.body.data.id}`).set(auth(amy.token));
    expect(detail.body.data.timeline.at(-1)).toMatchObject({ kind: "Call", text: "Outbound call, Connected." });
  });
});
