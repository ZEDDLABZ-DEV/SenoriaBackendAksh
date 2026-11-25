import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { integrationEnvKeys } from "../src/config";
import { parseLeadDetail, setMetaLeadFetcher, type MetaLeadDetail } from "../src/integrations/meta/graph";
import { metaHubSignature } from "../src/integrations/meta/signature";
import { resetIntegrationWarnings } from "../src/integrations/status";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();
const SECRET = "meta-app-secret";
const VERIFY = "meta-verify-token";
const PAGE_ID = "111222333";
const LEADGEN_ID = "444555666777";

const webhook = JSON.parse(readFileSync("tests/fixtures/meta/leadgen-webhook.json", "utf8"));
const leadDetail = JSON.parse(readFileSync("tests/fixtures/meta/lead-detail.json", "utf8"));

const savedEnv = new Map<string, string | undefined>();
let nodeEnv: string | undefined;
const fetches: string[] = [];

beforeAll(() => {
  nodeEnv = process.env.NODE_ENV;
  for (const key of integrationEnvKeys()) {
    savedEnv.set(key, process.env[key]);
  }
});

beforeEach(async () => {
  await prepare();
  resetIntegrationWarnings();
  fetches.length = 0;
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
  process.env.NODE_ENV = nodeEnv;
  setMetaLeadFetcher(async (leadgenId) => {
    fetches.push(leadgenId);
    return parseLeadDetail(leadgenId, leadDetail);
  });
});

afterAll(() => {
  setMetaLeadFetcher(null);
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

function enableMeta() {
  process.env.META_LEADS_ENABLED = "true";
  process.env.META_APP_ID = "meta-app-id";
  process.env.META_APP_SECRET = SECRET;
  process.env.META_PAGE_ID = PAGE_ID;
  process.env.META_PAGE_ACCESS_TOKEN = "page-token";
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY;
}

function postWebhook(body: unknown = webhook, secret = SECRET) {
  const raw = JSON.stringify(body);
  const req = request(app)
    .post("/api/v1/webhooks/meta/leads")
    .set("Content-Type", "application/json")
    .send(raw);
  if (secret) {
    req.set("X-Hub-Signature-256", metaHubSignature(Buffer.from(raw), secret));
  }
  return req;
}

describe("meta lead ads webhook", () => {
  it("answers the hub challenge only when the verify token matches", async () => {
    enableMeta();
    process.env.META_LEADS_ENABLED = "false";

    const ok = await request(app).get("/api/v1/webhooks/meta/leads").query({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY,
      "hub.challenge": "challenge-token",
    });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("challenge-token");

    const denied = await request(app).get("/api/v1/webhooks/meta/leads").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "challenge-token",
    });
    expect(denied.status).toBe(403);
  });

  it("creates one assigned lead from the fixture and ignores the duplicate post", async () => {
    enableMeta();
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
    const rep = await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy@example.com" });

    const created = await postWebhook();
    expect(created.status).toBe(200);
    expect(created.body.results).toEqual([
      { leadgenId: LEADGEN_ID, leadId: created.body.results[0].leadId, created: true },
    ]);
    expect(fetches).toEqual([LEADGEN_ID]);

    const leadId = created.body.results[0].leadId as string;
    const row = await prisma.lead.findUnique({ where: { id: leadId }, include: { timeline: { orderBy: { sortIndex: "asc" } } } });
    expect(row?.firstName).toBe("Maria");
    expect(row?.lastName).toBe("Chen");
    expect(row?.email).toBe("maria.chen@email.com");
    expect(row?.phone).toBe("+14165550142");
    expect(row?.source).toBe("Instagram");
    expect(row?.ownerId).toBe(rep.id);
    expect(row?.externalSource).toBe("meta");
    expect(row?.externalId).toBe(LEADGEN_ID);
    expect(row?.lastSyncedAt).toBeTruthy();
    expect(row?.timeline.map((event) => `${event.kind}:${event.text}`)).toEqual([
      "Lead:Lead received from a Instagram lead ad.",
      "Assignment:Assigned to Amy Alpha.",
    ]);

    const again = await postWebhook();
    expect(again.status).toBe(200);
    expect(again.body.results).toEqual([{ leadgenId: LEADGEN_ID, leadId, created: false }]);
    expect(await prisma.lead.count()).toBe(1);
    expect(fetches).toEqual([LEADGEN_ID]);
    const synced = info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("integration sync succeeded"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(synced).toEqual([
      {
        level: "info",
        message: "integration sync succeeded",
        integration: "meta",
        success: true,
        externalId: LEADGEN_ID,
        leadId,
      },
      {
        level: "info",
        message: "integration sync succeeded",
        integration: "meta",
        success: true,
        externalId: LEADGEN_ID,
        leadId,
      },
    ]);
    expect(JSON.stringify(synced)).not.toContain(SECRET);
    expect(JSON.stringify(synced)).not.toContain("page-token");
    } finally {
      info.mockRestore();
    }
  });

  it("creates nothing while Meta is disabled, unsigned, or signed incorrectly", async () => {
    enableMeta();
    await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy@example.com" });
    setMetaLeadFetcher(async () => {
      throw new Error("graph should not be called");
    });

    process.env.META_LEADS_ENABLED = "false";
    const disabled = await postWebhook();
    expect(disabled.status).toBe(200);
    expect(disabled.body.results).toEqual([]);

    process.env.META_LEADS_ENABLED = "true";
    delete process.env.META_APP_SECRET;
    const unsigned = await postWebhook(webhook, "");
    expect(unsigned.status).toBe(200);
    expect(unsigned.body.results).toEqual([]);

    process.env.META_APP_SECRET = SECRET;
    process.env.NODE_ENV = "production";
    delete process.env.META_APP_SECRET;
    const productionUnsigned = await request(app)
      .post("/api/v1/webhooks/meta/leads")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(webhook));
    expect(productionUnsigned.status).toBe(403);

    process.env.NODE_ENV = nodeEnv;
    process.env.META_APP_SECRET = SECRET;
    const badSignature = await postWebhook(webhook, "other-secret");
    expect(badSignature.status).toBe(403);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("reports meta configured and enabled from the status endpoint", async () => {
    enableMeta();
    const admin = await createUser({ role: "ADMIN", email: "admin@example.com" });
    const session = await login(app, admin.email, PASSWORD);
    const enabled = await request(app).get("/api/v1/integrations/status").set(auth(session.body.data.accessToken));
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.meta).toEqual({ enabled: true, configured: true });
    expect(enabled.body.data.ringcentral).toEqual({ enabled: false, configured: false });

    process.env.META_LEADS_ENABLED = "false";
    const flaggedOff = await request(app).get("/api/v1/integrations/status").set(auth(session.body.data.accessToken));
    expect(flaggedOff.body.data.meta).toEqual({ enabled: false, configured: true });
  });

  it("uses META_LEAD_FIELD_MAP when the form uses a custom phone question", async () => {
    enableMeta();
    await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy@example.com" });
    process.env.META_LEAD_FIELD_MAP = JSON.stringify({ phone: ["mobile_phone"] });
    const custom: MetaLeadDetail = parseLeadDetail(LEADGEN_ID, {
      id: LEADGEN_ID,
      platform: "fb",
      field_data: [
        { name: "full_name", values: ["Helen Cho"] },
        { name: "mobile_phone", values: ["416-555-0199"] },
      ],
    });
    setMetaLeadFetcher(async () => custom);

    const response = await postWebhook();
    expect(response.status).toBe(200);
    expect(response.body.results[0].created).toBe(true);
    const row = await prisma.lead.findUnique({ where: { id: response.body.results[0].leadId } });
    expect(row?.phone).toBe("416-555-0199");
    expect(row?.source).toBe("Facebook");
    expect(row?.firstName).toBe("Helen");
    expect(row?.lastName).toBe("Cho");
  });
});
