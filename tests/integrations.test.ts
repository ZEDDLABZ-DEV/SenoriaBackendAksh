import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationCredentialValues, integrationEnv, integrationEnvKeys } from "../src/config";
import { integrationAdapters } from "../src/integrations/adapters";
import { getIntegrationStatus, resetIntegrationWarnings } from "../src/integrations/status";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();
const savedEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of integrationEnvKeys()) {
    savedEnv.set(key, process.env[key]);
  }
});

beforeEach(async () => {
  await prepare();
  resetIntegrationWarnings();
  for (const key of integrationEnvKeys()) {
    delete process.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreClock();
});

async function tokenFor(role: "ADMIN" | "SALES" | "CAREGIVER") {
  const user = await createUser({ role, email: `${role.toLowerCase()}@example.com` });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

function fillRequired(name: keyof typeof integrationEnv, value: string) {
  for (const key of integrationEnv[name].required) {
    process.env[key] = value;
  }
}

describe("integration status", () => {
  it("rejects missing and caregiver tokens", async () => {
    const missing = await request(app).get("/api/v1/integrations/status");
    expect(missing.status).toBe(401);

    const caregiver = await tokenFor("CAREGIVER");
    const forbidden = await request(app).get("/api/v1/integrations/status").set(auth(caregiver));
    expect(forbidden.status).toBe(403);
  });

  it("reports every vendor disabled when flags and secrets are empty", async () => {
    const admin = await tokenFor("ADMIN");
    const sales = await tokenFor("SALES");

    for (const token of [admin, sales]) {
      const response = await request(app).get("/api/v1/integrations/status").set(auth(token));
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        meta: { enabled: false, configured: false },
        ringcentral: { enabled: false, configured: false },
        zoho: { enabled: false, configured: false },
        outlook: { enabled: false, configured: false },
      });
    }
  });

  it("treats a flag without credentials as disabled and warns once", () => {
    process.env.META_LEADS_ENABLED = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(getIntegrationStatus().meta).toEqual({ enabled: false, configured: false });
      expect(getIntegrationStatus().meta.enabled).toBe(false);
      const warnings = warn.mock.calls.map((call) => String(call[0]));
      expect(warnings.filter((line) => line.includes("meta") && line.includes("disabled"))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("enables a vendor only when the flag is true and required secrets are set", () => {
    process.env.META_LEADS_ENABLED = "true";
    fillRequired("meta", "placeholder");
    const status = getIntegrationStatus();
    expect(status.meta).toEqual({ enabled: true, configured: true });
    expect(status.ringcentral.enabled).toBe(false);
    expect(integrationCredentialValues("meta").META_APP_SECRET).toBe("placeholder");
    expect(integrationCredentialValues("outlook").OUTLOOK_CLIENT_ID).toBe("");
  });

  it("leaves lead responses unchanged and stores null sync columns", async () => {
    const admin = await tokenFor("ADMIN");
    const created = await request(app).post("/api/v1/leads").set(auth(admin)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Phone",
      about: "",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.externalSource).toBeUndefined();
    expect(created.body.data.externalId).toBeUndefined();
    expect(created.body.data.lastSyncedAt).toBeUndefined();
    expect(created.body.data.syncError).toBeUndefined();

    const row = await prisma.lead.findUnique({ where: { id: created.body.data.id } });
    expect(row?.externalSource).toBeNull();
    expect(row?.externalId).toBeNull();
    expect(row?.lastSyncedAt).toBeNull();
    expect(row?.syncError).toBeNull();
  });

  it("no-ops a disabled adapter and refuses to call a vendor when the flag is fully configured", async () => {
    await expect(integrationAdapters.meta.sync()).resolves.toBeUndefined();
    await expect(integrationAdapters.ringcentral.sync()).resolves.toBeUndefined();
    await expect(integrationAdapters.zoho.sync()).resolves.toBeUndefined();
    await expect(integrationAdapters.outlook.sync()).resolves.toBeUndefined();

    process.env.OUTLOOK_ENABLED = "true";
    fillRequired("outlook", "placeholder");
    await expect(integrationAdapters.outlook.sync()).resolves.toBeUndefined();

    process.env.META_LEADS_ENABLED = "true";
    fillRequired("meta", "placeholder");
    await expect(integrationAdapters.meta.sync()).rejects.toThrow(/not implemented/);
  });
});
