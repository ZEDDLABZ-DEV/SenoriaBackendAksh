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

async function tokenFor(role: "ADMIN" | "SALES" | "CAREGIVER", input: { email?: string; firstName?: string; lastName?: string; status?: string } = {}) {
  const user = await createUser({ role, ...input });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

function leadBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Maria",
    lastName: "Chen",
    phone: "416-555-0142",
    email: "maria.chen@email.com",
    source: "Facebook",
    about: "Daughter asking about weekday morning care",
    ...overrides,
  };
}

describe("sales leads", () => {
  it("round-robins active sales users and skips inactive ones", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    await createUser({ role: "SALES", firstName: "Ina", lastName: "Aaron", status: "inactive", email: "ina@example.com" });
    const amy = await createUser({ role: "SALES", firstName: "Amy", lastName: "Alpha", email: "amy@example.com" });
    const bea = await createUser({ role: "SALES", firstName: "Bea", lastName: "Beta", email: "bea@example.com" });

    const first = await request(app).post("/api/v1/leads").set(auth(admin.token)).send(leadBody());
    expect(first.status).toBe(201);
    expect(first.body.data.ownerId).toBe(amy.id);
    expect(first.body.data.ownerName).toBe("Amy Alpha");
    expect(first.body.data.stage).toBe("New");
    expect(first.body.data.timeline.map((event: { kind: string; text: string }) => `${event.kind}:${event.text}`)).toEqual([
      "Lead:Lead received from a Facebook lead ad.",
      "Assignment:Assigned to Amy Alpha.",
    ]);

    const second = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ firstName: "Helen", phone: "416-555-0199", email: "helen@email.com" }));
    expect(second.status).toBe(201);
    expect(second.body.data.ownerId).toBe(bea.id);

    const third = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ firstName: "Noah", phone: "416-555-0188", email: null }));
    expect(third.body.data.ownerId).toBe(amy.id);

    const state = await request(app).get("/api/v1/sales/assignment-state").set(auth(admin.token));
    expect(state.status).toBe(200);
    expect(state.body.data.activeRepIds).toEqual([amy.id, bea.id]);
    expect(state.body.data.nextOwnerId).toBe(bea.id);
    expect(state.body.data.nextOwnerName).toBe("Bea Beta");

    const manual = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ firstName: "Pat", phone: "416-555-0170", email: "pat@email.com", ownerId: (await prismaInactive(admin.token)) }));
    expect(manual.status).toBe(201);
    expect(manual.body.data.ownerName).toBe("Ina Aaron");

    const afterManual = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ firstName: "Quinn", phone: "416-555-0160", email: "quinn@email.com" }));
    expect(afterManual.body.data.ownerId).toBe(bea.id);
  });

  it("leaves a lead unassigned when nobody is active", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com" });
    const created = await request(app).post("/api/v1/leads").set(auth(admin.token)).send(leadBody());
    expect(created.status).toBe(201);
    expect(created.body.data.ownerId).toBeNull();
    expect(created.body.data.timeline.map((event: { text: string }) => event.text)).toContain(
      "No active sales executive for round-robin.",
    );
  });

  it("hides other owners from sales and records stage and notes", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });

    const created = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ ownerId: amy.user.id }));
    expect(created.status).toBe(201);
    const leadId = created.body.data.id as string;

    const hiddenList = await request(app).get("/api/v1/leads").set(auth(bea.token));
    expect(hiddenList.status).toBe(200);
    expect(hiddenList.body.data.data).toEqual([]);

    const hidden = await request(app).get(`/api/v1/leads/${leadId}`).set(auth(bea.token));
    expect(hidden.status).toBe(403);

    const visible = await request(app).get("/api/v1/leads").set(auth(amy.token));
    expect(visible.body.data.data).toHaveLength(1);
    expect(visible.body.data.data[0].queues).toEqual(expect.arrayContaining(["new", "mine"]));
    expect(visible.body.data.meta.total).toBe(1);

    const blockedAssign = await request(app)
      .post(`/api/v1/leads/${leadId}/assign`)
      .set(auth(amy.token))
      .send({ ownerId: bea.user.id });
    expect(blockedAssign.status).toBe(403);

    const stage = await request(app)
      .patch(`/api/v1/leads/${leadId}/stage`)
      .set(auth(amy.token))
      .send({ stage: "Contacted" });
    expect(stage.status).toBe(200);
    expect(stage.body.data.stage).toBe("Contacted");
    expect(stage.body.data.timeline.at(-1)).toMatchObject({ kind: "Stage", text: "Moved to Contacted." });

    const invalid = await request(app)
      .patch(`/api/v1/leads/${leadId}/stage`)
      .set(auth(amy.token))
      .send({ stage: "Hot" });
    expect(invalid.status).toBe(422);

    const note = await request(app)
      .post(`/api/v1/leads/${leadId}/notes`)
      .set(auth(amy.token))
      .send({
        outcome: "Connected",
        text: "Spoke with her daughter",
        followUpDate: "2026-10-20",
        followUpTime: "10:00",
        stage: "Qualified",
      });
    expect(note.status).toBe(200);
    expect(note.body.data.stage).toBe("Qualified");
    expect(note.body.data.nextStep).toBe("Follow-up call on 2026-10-20 at 10:00");
    expect(note.body.data.nextStepAt).toBe("2026-10-20T17:00:00.000Z");
    expect(note.body.data.timeline.some((event: { kind: string; meta: { outcome?: string } | null }) => event.kind === "Note" && event.meta?.outcome === "Connected")).toBe(true);
    expect(note.body.data.timeline.at(-1)).toMatchObject({ kind: "Stage", text: "Moved to Qualified." });

    const assigned = await request(app)
      .post(`/api/v1/leads/${leadId}/assign`)
      .set(auth(admin.token))
      .send({ ownerId: bea.user.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ownerId).toBe(bea.user.id);

    const caregiver = await tokenFor("CAREGIVER", { email: "care@example.com" });
    const denied = await request(app).get("/api/v1/leads").set(auth(caregiver.token));
    expect(denied.status).toBe(403);
  });

  it("counts due and overdue from the requested offset", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const created = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ ownerId: amy.user.id }));
    const leadId = created.body.data.id as string;
    const patched = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set(auth(admin.token))
      .send({ nextStep: "Call back", nextStepAt: "2026-10-19T16:00:00.000Z" });
    expect(patched.status).toBe(200);

    const won = await request(app)
      .post("/api/v1/leads")
      .set(auth(admin.token))
      .send(leadBody({ firstName: "Won", phone: "416-555-0101", email: "won@email.com", ownerId: amy.user.id }));
    await request(app)
      .patch(`/api/v1/leads/${won.body.data.id}/stage`)
      .set(auth(admin.token))
      .send({ stage: "Won" });
    await request(app)
      .patch(`/api/v1/leads/${won.body.data.id}`)
      .set(auth(admin.token))
      .send({ nextStepAt: "2026-10-01T16:00:00.000Z", nextStep: "Closed" });

    const vancouver = await request(app).get("/api/v1/leads/queues/summary").set(auth(admin.token));
    expect(vancouver.body.data).toMatchObject({ new: 1, due: 1, overdue: 0, mine: 0 });

    const india = await request(app)
      .get("/api/v1/leads/queues/summary")
      .query({ timeZoneOffset: "+05:30" })
      .set(auth(admin.token));
    expect(india.body.data).toMatchObject({ new: 1, due: 0, overdue: 1, mine: 0 });

    const mine = await request(app).get("/api/v1/leads/queues/summary").set(auth(amy.token));
    expect(mine.body.data).toMatchObject({ new: 1, due: 1, overdue: 0, mine: 2 });

    const filtered = await request(app)
      .get("/api/v1/leads/queues/summary")
      .query({ ownerId: amy.user.id })
      .set(auth(admin.token));
    expect(filtered.body.data.mine).toBe(2);

    const dueList = await request(app).get("/api/v1/leads").query({ queue: "due" }).set(auth(admin.token));
    expect(dueList.body.data.data.map((lead: { firstName: string }) => lead.firstName)).toEqual(["Maria"]);
  });

  it("rejects an incomplete lead", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com" });
    const response = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({ firstName: "Maria" });
    expect(response.status).toBe(422);
    expect(response.body.errors.phone).toEqual(expect.any(Array));
    expect(response.body.errors.source).toEqual(expect.any(Array));
  });
});

async function prismaInactive(adminToken: string) {
  const listed = await request(app).get("/api/v1/users/sales").query({ status: "inactive" }).set(auth(adminToken));
  return listed.body.data.data[0].id as string;
}
