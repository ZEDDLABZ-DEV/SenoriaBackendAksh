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

async function tokenFor(role: "ADMIN" | "SALES", input: { email: string; firstName: string; lastName: string }) {
  const user = await createUser({ role, ...input });
  const response = await login(app, user.email, PASSWORD);
  expect(response.status).toBe(200);
  return { user, token: response.body.data.accessToken as string };
}

describe("sales meetings", () => {
  it("books, updates, and removes meetings inside a date range", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const bea = await tokenFor("SALES", { email: "bea@example.com", firstName: "Bea", lastName: "Beta" });
    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Helen",
      lastName: "Wright",
      phone: "604-555-0190",
      source: "Referral",
      ownerId: amy.user.id,
    });
    const leadId = lead.body.data.id as string;

    const created = await request(app).post("/api/v1/sales/meetings").set(auth(amy.token)).send({
      leadId,
      title: "Home visit",
      kind: "Visit",
      startAt: "2026-10-20T19:30:00.000Z",
      endAt: "2026-10-20T20:30:00.000Z",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      leadId,
      ownerId: amy.user.id,
      title: "Home visit",
      person: "Helen Wright",
      kind: "Visit",
    });

    const detail = await request(app).get(`/api/v1/leads/${leadId}`).set(auth(amy.token));
    expect(detail.body.data.nextStep).toBe("Home visit");
    expect(detail.body.data.timeline.at(-1)).toMatchObject({
      kind: "Meeting",
      text: "Visit scheduled: Home visit.",
    });

    const week = await request(app)
      .get("/api/v1/sales/meetings")
      .query({ from: "2026-10-20", to: "2026-10-20" })
      .set(auth(amy.token));
    expect(week.body.data.map((meeting: { id: string }) => meeting.id)).toEqual([created.body.data.id]);

    const otherDay = await request(app)
      .get("/api/v1/sales/meetings")
      .query({ from: "2026-10-21", to: "2026-10-21" })
      .set(auth(amy.token));
    expect(otherDay.body.data).toEqual([]);

    const hidden = await request(app)
      .get("/api/v1/sales/meetings")
      .query({ from: "2026-10-20", to: "2026-10-20" })
      .set(auth(bea.token));
    expect(hidden.body.data).toEqual([]);
    const blocked = await request(app)
      .patch(`/api/v1/sales/meetings/${created.body.data.id}`)
      .set(auth(bea.token))
      .send({ title: "Taken" });
    expect(blocked.status).toBe(403);

    const renamed = await request(app)
      .patch(`/api/v1/sales/meetings/${created.body.data.id}`)
      .set(auth(amy.token))
      .send({ title: "Home assessment" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe("Home assessment");

    const removed = await request(app).delete(`/api/v1/sales/meetings/${created.body.data.id}`).set(auth(amy.token));
    expect(removed.status).toBe(200);
    const after = await request(app)
      .get("/api/v1/sales/meetings")
      .query({ from: "2026-10-20", to: "2026-10-20" })
      .set(auth(admin.token));
    expect(after.body.data).toEqual([]);
    const timeline = await request(app).get(`/api/v1/leads/${leadId}`).set(auth(admin.token));
    expect(timeline.body.data.timeline.at(-1).text).toBe("Meeting removed: Home assessment.");

    const missingRange = await request(app).get("/api/v1/sales/meetings").set(auth(admin.token));
    expect(missingRange.status).toBe(422);
  });

  it("turns a follow-up note into a call on the calendar", async () => {
    const admin = await tokenFor("ADMIN", { email: "admin@example.com", firstName: "Ada", lastName: "Admin" });
    const amy = await tokenFor("SALES", { email: "amy@example.com", firstName: "Amy", lastName: "Alpha" });
    const lead = await request(app).post("/api/v1/leads").set(auth(admin.token)).send({
      firstName: "Maria",
      lastName: "Chen",
      phone: "416-555-0142",
      source: "Facebook",
      ownerId: amy.user.id,
    });
    const note = await request(app)
      .post(`/api/v1/leads/${lead.body.data.id}/notes`)
      .set(auth(amy.token))
      .send({
        outcome: "Booked",
        text: "Booked the intro call",
        followUpDate: "2026-10-20",
        followUpTime: "10:00",
      });
    expect(note.status).toBe(200);
    expect(note.body.data.meetingId).toEqual(expect.any(String));

    const meetings = await request(app)
      .get("/api/v1/sales/meetings")
      .query({ from: "2026-10-20", to: "2026-10-20" })
      .set(auth(amy.token));
    expect(meetings.body.data).toEqual([
      expect.objectContaining({
        id: note.body.data.meetingId,
        kind: "Call",
        person: "Maria Chen",
        title: "Follow-up call on 2026-10-20 at 10:00",
        startAt: "2026-10-20T17:00:00.000Z",
        endAt: "2026-10-20T17:30:00.000Z",
      }),
    ]);
  });
});
