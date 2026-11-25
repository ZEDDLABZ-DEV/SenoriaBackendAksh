import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { integrationEnvKeys } from "../src/config";
import { zohoCredentialsLookReal } from "../src/integrations/zoho/credentials";
import { resetZohoAuthCache } from "../src/integrations/zoho/auth";
import { setZohoHttp, type ZohoHttp } from "../src/integrations/zoho/http";
import { enqueueZohoLeadOutbound, resetZohoOutboundGuard } from "../src/integrations/zoho/outbound";
import { resetIntegrationWarnings } from "../src/integrations/status";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";
import { createApp } from "../src/app";

const app = testApp();
const SECRET = "zoho-webhook-secret";
const EXTERNAL_ID = "82810000000332025";
const fixture = JSON.parse(readFileSync("tests/fixtures/zoho/amit-bishnoi.json", "utf8"));

const savedEnv = new Map<string, string | undefined>();
const calls: string[] = [];

const recordingHttp: ZohoHttp = async (url) => {
  calls.push(url);
  return new Response("{}", { status: 500 });
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
  resetZohoOutboundGuard();
  calls.length = 0;
  setZohoHttp(recordingHttp);
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
});

afterAll(() => {
  setZohoHttp(null);
  resetZohoAuthCache();
  resetZohoOutboundGuard();
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreClock();
});

function enableInbound() {
  process.env.ZOHO_INBOUND_ENABLED = "true";
  process.env.ZOHO_WEBHOOK_SECRET = SECRET;
}

function realOAuth() {
  process.env.ZOHO_CLIENT_ID = "1000.ABCDEFGHIJKLMNOP";
  process.env.ZOHO_CLIENT_SECRET = "crm-client-secret-value";
  process.env.ZOHO_REFRESH_TOKEN = "1000.refresh-token-value";
  process.env.ZOHO_ACCOUNTS_DOMAIN = "accounts.zohocloud.ca";
  process.env.ZOHO_API_DOMAIN = "www.zohoapis.ca";
}

function dummyOAuth() {
  process.env.ZOHO_CLIENT_ID = "dummy-client-id";
  process.env.ZOHO_CLIENT_SECRET = "dummy-client-secret";
  process.env.ZOHO_REFRESH_TOKEN = "dummy-refresh-token";
  process.env.ZOHO_ACCOUNTS_DOMAIN = "accounts.zohocloud.ca";
  process.env.ZOHO_API_DOMAIN = "www.zohoapis.ca";
}

function postLead(body: Record<string, unknown> = fixture, secret = SECRET) {
  const req = request(app).post("/api/v1/webhooks/zoho/leads").set("Content-Type", "application/json").send(body);
  if (secret) {
    req.set("X-Zoho-Webhook-Secret", secret);
  }
  return req;
}

describe("zoho inbound lead webhook", () => {
  it("rejects a missing or wrong secret and creates no lead", async () => {
    enableInbound();
    const missing = await postLead(fixture, "");
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual({ received: false });

    const wrong = await postLead(fixture, "other-secret");
    expect(wrong.status).toBe(403);
    expect(await prisma.lead.count()).toBe(0);

    delete process.env.ZOHO_WEBHOOK_SECRET;
    const unsigned = await postLead();
    expect(unsigned.status).toBe(403);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("accepts the secret while inbound is off and creates no lead", async () => {
    process.env.ZOHO_WEBHOOK_SECRET = SECRET;
    const ignored = await postLead();
    expect(ignored.status).toBe(200);
    expect(ignored.body).toEqual({ received: true, results: [] });
    expect(await prisma.lead.count()).toBe(0);

    const wrong = await postLead(fixture, "other-secret");
    expect(wrong.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("creates one round-robin lead from the fixture and ignores the duplicate post", async () => {
    enableInbound();
    realOAuth();
    process.env.ZOHO_OUTBOUND_ENABLED = "true";
    expect(zohoCredentialsLookReal()).toBe(true);

    await createUser({ role: "SALES", firstName: "Bea", lastName: "Beta", email: "bea@example.com" });
    const amy = await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy@example.com" });

    const created = await postLead();
    expect(created.status).toBe(200);
    const leadId = created.body.results[0].leadId as string;
    expect(created.body).toEqual({
      received: true,
      results: [{ externalId: EXTERNAL_ID, leadId, created: true }],
    });

    const row = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { timeline: { orderBy: { sortIndex: "asc" } } },
    });
    expect(row?.firstName).toBe("Amit");
    expect(row?.lastName).toBe("Bishnoi");
    expect(row?.email).toBe("amit@sample.com");
    expect(row?.phone).toBe("9876543210");
    expect(row?.source).toBe("Phone");
    expect(row?.stage).toBe("Contacted");
    expect(row?.about).toBe("testing notes");
    expect(row?.ownerId).toBe(amy.id);
    expect(row?.externalSource).toBe("zoho");
    expect(row?.externalId).toBe(EXTERNAL_ID);
    expect(row?.zohoRecordId).toBe(EXTERNAL_ID);
    expect(row?.lastSyncedAt).toBeTruthy();
    expect(row?.syncError).toBeNull();
    expect(row?.timeline.map((event) => `${event.kind}:${event.text}`)).toEqual([
      "Lead:Lead received from Zoho.",
      "Assignment:Assigned to Amy Alpha.",
    ]);
    expect(row?.timeline[0].meta).toMatchObject({
      origin: "zoho",
      direction: "inbound",
      leadSource: "Cold Call",
      mappedSource: "Phone",
      unmappedSource: false,
      leadStatus: "Contact in Future",
      mappedStage: "Contacted",
    });

    const again = await postLead();
    expect(again.status).toBe(200);
    expect(again.body.results).toEqual([{ externalId: EXTERNAL_ID, leadId, created: false }]);
    expect(await prisma.lead.count()).toBe(1);
    const replay = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { timeline: true },
    });
    expect(replay?.timeline).toHaveLength(2);
    expect(replay?.ownerId).toBe(amy.id);

    const bareId = { ...fixture, id: EXTERNAL_ID, Description: "updated notes" };
    const updated = await postLead(bareId);
    expect(updated.body.results).toEqual([{ externalId: EXTERNAL_ID, leadId, created: false }]);
    const after = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { timeline: { orderBy: { createdAt: "asc" } } },
    });
    expect(await prisma.lead.count()).toBe(1);
    expect(after?.about).toBe("updated notes");
    expect(after?.externalId).toBe(EXTERNAL_ID);
    expect(after?.timeline.map((event) => event.text)).toContain("Updated from Zoho.");
    expect(after?.timeline).toHaveLength(3);
    expect(calls).toEqual([]);

    enqueueZohoLeadOutbound("not-from-inbound");
    expect(calls).toEqual([]);
  });

  it("links an existing lead by phone without a second row or a new owner", async () => {
    enableInbound();
    const admin = await createUser({ role: "ADMIN", email: "admin-zoho@example.com", firstName: "Ada", lastName: "Admin" });
    const owner = await createUser({ role: "SALES", firstName: "Bea", lastName: "Beta", email: "bea-link@example.com" });
    const session = await login(app, admin.email, PASSWORD);
    expect(session.status).toBe(200);
    const seeded = await request(app)
      .post("/api/v1/leads")
      .set(auth(session.body.data.accessToken as string))
      .send({
        firstName: "Amit",
        lastName: "Bishnoi",
        phone: "(987) 654-3210",
        email: "someone.else@example.com",
        source: "Referral",
        about: "existing",
        ownerId: owner.id,
      });
    expect(seeded.status).toBe(201);

    const linked = await postLead();
    expect(linked.status).toBe(200);
    expect(linked.body.results[0]).toMatchObject({ externalId: EXTERNAL_ID, created: false, leadId: seeded.body.data.id });
    expect(await prisma.lead.count()).toBe(1);
    const row = await prisma.lead.findUnique({
      where: { id: seeded.body.data.id as string },
      include: { timeline: { orderBy: { createdAt: "asc" } } },
    });
    expect(row?.ownerId).toBe(owner.id);
    expect(row?.externalSource).toBe("zoho");
    expect(row?.externalId).toBe(EXTERNAL_ID);
    expect(row?.phone).toBe("9876543210");
    expect(row?.source).toBe("Phone");
    expect(row?.stage).toBe("Contacted");
    expect(row?.timeline.map((event) => event.text)).toContain("Updated from Zoho.");

    const again = await postLead();
    const replay = await prisma.lead.findUnique({
      where: { id: seeded.body.data.id as string },
      include: { timeline: true },
    });
    expect(again.body.results[0].created).toBe(false);
    expect(replay?.timeline).toHaveLength(row?.timeline.length ?? 0);
    expect(calls).toEqual([]);
  });

  it("accepts a form body that uses workflow field names", async () => {
    enableInbound();
    const rep = await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy-form@example.com" });
    const created = await request(app)
      .post("/api/v1/webhooks/zoho/leads")
      .set("X-Zoho-Webhook-Secret", SECRET)
      .type("form")
      .send({
        "Record Id": "zcrm_82810000000332025",
        "First Name": "Amit",
        "Last Name": "Bishnoi",
        Email: "amit@sample.com",
        Mobile: "9876543210",
        "Lead Source": "Cold Call",
        "Lead Status": "Contact in Future",
        Description: "testing notes",
      });
    expect(created.status).toBe(200);
    expect(created.body.results[0].created).toBe(true);
    const row = await prisma.lead.findUnique({ where: { id: created.body.results[0].leadId as string } });
    expect(row?.ownerId).toBe(rep.id);
    expect(row?.externalId).toBe(EXTERNAL_ID);
    expect(row?.phone).toBe("9876543210");
    expect(row?.source).toBe("Phone");
    expect(row?.stage).toBe("Contacted");
  });

  it("stores an unknown Zoho source and status as the defaults plus the raw values", async () => {
    enableInbound();
    await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy-raw@example.com" });
    const created = await postLead({
      ...fixture,
      Lead_Source: "Billboard",
      Lead_Status: "Not a status",
    });
    expect(created.body.results[0].created).toBe(true);
    const row = await prisma.lead.findUnique({ where: { id: created.body.results[0].leadId as string } });
    expect(row?.source).toBe("Referral");
    expect(row?.stage).toBe("New");
    expect(row?.about).toBe("testing notes\nZoho Lead_Source: Billboard\nZoho Lead_Status: Not a status");
  });

  it("applies a JSON map override", async () => {
    enableInbound();
    process.env.ZOHO_LEAD_MAP = JSON.stringify({
      source: { "Cold Call": "Referral" },
      stage: { "Contact in Future": "Qualified" },
    });
    await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy-map@example.com" });
    const created = await postLead();
    const row = await prisma.lead.findUnique({ where: { id: created.body.results[0].leadId as string } });
    expect(row?.source).toBe("Referral");
    expect(row?.stage).toBe("Qualified");
  });

  it("processes a full payload with dummy oauth and skips an id-only payload", async () => {
    enableInbound();
    dummyOAuth();
    expect(zohoCredentialsLookReal()).toBe(false);
    expect(createApp()).toBeTruthy();
    await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy-dummy@example.com" });

    const created = await postLead();
    expect(created.status).toBe(200);
    expect(created.body.results[0].created).toBe(true);
    expect(calls).toEqual([]);

    const idOnly = await postLead({ id: "zcrm_82810000000999999" });
    expect(idOnly.status).toBe(200);
    expect(idOnly.body.results).toEqual([
      { externalId: "82810000000999999", leadId: null, created: false },
    ]);
    expect(await prisma.lead.count()).toBe(1);
    expect(calls).toEqual([]);
  });

  it("loads an id-only payload from Zoho when the oauth values look real", async () => {
    enableInbound();
    realOAuth();
    const rep = await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy-get@example.com" });
    setZohoHttp(async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.endsWith("/oauth/v2/token")) {
        return json(200, { access_token: "zoho-access", expires_in: 3600 });
      }
      if (url.endsWith(`/crm/v2/Leads/${EXTERNAL_ID}`)) {
        expect(init.headers.Authorization).toBe("Zoho-oauthtoken zoho-access");
        return json(200, {
          data: [
            {
              id: EXTERNAL_ID,
              First_Name: "Amit",
              Last_Name: "Bishnoi",
              Email: "amit@sample.com",
              Phone: "9876543210",
              Lead_Source: "Facebook",
              Lead_Status: "Not Contacted",
              Description: "testing notes",
            },
          ],
        });
      }
      return json(404, {});
    });

    const created = await postLead({ id: `zcrm_${EXTERNAL_ID}` });
    expect(created.status).toBe(200);
    expect(created.body.results[0].created).toBe(true);
    const row = await prisma.lead.findUnique({ where: { id: created.body.results[0].leadId as string } });
    expect(row?.ownerId).toBe(rep.id);
    expect(row?.source).toBe("Facebook");
    expect(row?.stage).toBe("New");
    expect(row?.externalId).toBe(EXTERNAL_ID);
    expect(calls).toEqual([
      "POST https://accounts.zohocloud.ca/oauth/v2/token",
      `GET https://www.zohoapis.ca/crm/v2/Leads/${EXTERNAL_ID}`,
    ]);
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
