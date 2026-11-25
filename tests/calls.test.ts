import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CLOCK, PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();

beforeEach(async () => {
  await prepare();
});

afterAll(() => {
  restoreClock();
});

async function tokenFor(role: "ADMIN" | "SALES", input: { email: string; firstName: string; lastName: string }) {
  const user = await createUser({ role, ...input });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

describe("sales calls", () => {
  it("logs a call on a lead and keeps unmatched inbound visible to every sales user", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });

    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Phone",
      ownerId: amy.user.id,
    });
    expect(lead.status).toBe(201);

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
      direction: "Outbound",
      durationSeconds: 252,
      durationLabel: "4 min 12 sec",
      result: "Connected",
      recordingAvailable: false,
      recordingUrl: null,
      ownerId: amy.user.id,
      ownerName: "Amy Alpha",
    });

    const detail = await request(app).get(`/api/v1/leads/${lead.body.data.id}`).set(auth(amy.token));
    expect(detail.body.data.lastTouchAt).toBe(CLOCK);
    expect(detail.body.data.timeline.at(-1)).toMatchObject({ kind: "Call", text: "Outbound call, Connected." });

    const hidden = await request(app).get(`/api/v1/calls/${logged.body.data.id}`).set(auth(bea.token));
    expect(hidden.status).toBe(403);
    const beaList = await request(app).get("/api/v1/calls").set(auth(bea.token));
    expect(beaList.body.data.data).toEqual([]);

    const inbound = await request(app).post("/api/v1/calls").set(auth(amy.token)).send({
      phone: "437-555-0164",
      direction: "Inbound",
      startedAt: "2026-11-19T21:00:00.000Z",
      result: "Missed",
    });
    expect(inbound.status).toBe(201);
    expect(inbound.body.data.leadId).toBeNull();
    expect(inbound.body.data.name).toBe("Unknown caller");

    const shared = await request(app).get("/api/v1/calls").set(auth(bea.token));
    expect(shared.body.data.data.map((call: { id: string }) => call.id)).toEqual([inbound.body.data.id]);

    const amyCalls = await request(app).get("/api/v1/calls").query({ result: "Connected" }).set(auth(amy.token));
    expect(amyCalls.body.data.data).toHaveLength(1);
    expect(amyCalls.body.data.meta.total).toBe(1);

    const invalid = await request(app).post("/api/v1/calls").set(auth(amy.token)).send({
      phone: "416-555-0142",
      direction: "Sideways",
      startedAt: "2026-11-19T20:14:00.000Z",
      result: "Connected",
    });
    expect(invalid.status).toBe(422);
  });
});
