import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, auth, createUser, login, prepare, restoreClock, testApp } from "./helpers";

const app = testApp();

beforeEach(async () => {
  await prepare();
});

afterAll(() => {
  restoreClock();
});

async function tokenFor(role: "ADMIN" | "SALES", input: { email: string; firstName: string; lastName: string; status?: string }) {
  const user = await createUser({ role, ...input });
  if (input.status === "inactive") {
    return { user, token: "" };
  }
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

describe("salespeople", () => {
  it("returns one sales account and oversight counts", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const inactive = await tokenFor("SALES", {
      email: "ira@example.com",
      firstName: "Ira",
      lastName: "Inactive",
      status: "inactive",
    });

    const self = await request(app).get(`/api/v1/users/sales/${amy.user.id}`).set(auth(amy.token));
    expect(self.status).toBe(200);
    expect(self.body.data).toMatchObject({
      id: amy.user.id,
      firstName: "Amy",
      lastName: "Alpha",
      role: "SALES",
      status: "active",
    });

    const other = await request(app).get(`/api/v1/users/sales/${admin.user.id}`).set(auth(amy.token));
    expect(other.status).toBe(403);
    const byAdmin = await request(app).get(`/api/v1/users/sales/${inactive.user.id}`).set(auth(admin.token));
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.data.status).toBe("inactive");

    const open = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Facebook",
      ownerId: amy.user.id,
    });
    await request(app).patch(`/api/v1/leads/${open.body.data.id}`).set(auth(admin.token)).send({
      nextStep: "Call back",
      nextStepAt: "2026-10-01T16:00:00.000Z",
    });
    const won = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Owen",
      lastName: "Brooks",
      phone: "778-555-0177",
      source: "Phone",
      ownerId: amy.user.id,
    });
    await request(app).patch(`/api/v1/leads/${won.body.data.id}/stage`).set(auth(admin.token)).send({ stage: "Won" });

    const list = await request(app).get("/api/v1/salespeople").set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: amy.user.id, inRoundRobin: true, assignedLeadCount: 1 }),
      expect.objectContaining({ id: inactive.user.id, inRoundRobin: false, assignedLeadCount: 0 }),
    ]);

    const denied = await request(app).get("/api/v1/salespeople").set(auth(amy.token));
    expect(denied.status).toBe(403);

    const detail = await request(app).get(`/api/v1/salespeople/${amy.user.id}`).set(auth(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.stats).toEqual({ open: 1, won: 1, lost: 0, overdue: 1 });
    expect(detail.body.data.currentLeads.map((lead: { firstName: string }) => lead.firstName)).toEqual(["Maria"]);
    expect(detail.body.data.pastLeads.map((lead: { firstName: string }) => lead.firstName)).toEqual(["Owen"]);
    expect(detail.body.data.events[0]).toMatchObject({
      kind: "Stage",
      leadName: "Owen Brooks",
      text: "Moved to Won.",
    });
  });
});
