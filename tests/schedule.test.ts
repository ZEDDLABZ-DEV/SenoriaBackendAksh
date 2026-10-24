import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  PASSWORD,
  TODAY,
  auth,
  checkInBody,
  createAppointment,
  createClientFor,
  createPlan,
  createUser,
  login,
  prepare,
  restoreClock,
  testApp,
} from "./helpers";

const app = testApp();

beforeEach(async () => {
  await prepare();
});

afterAll(() => {
  restoreClock();
});

async function adminToken() {
  const admin = await createUser({ role: "ADMIN", email: "admin@example.com" });
  const response = await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: PASSWORD });
  return response.body.data.accessToken as string;
}

async function setup() {
  const token = await adminToken();
  const caregiver = await createUser({ email: "alex.rivera@example.com" });
  const client = await createClientFor(caregiver.id, { firstName: "Margaret", lastName: "Chen" });
  return { token, caregiver, client };
}

const twiceDaily = [
  { startTime: "11:00", endTime: "12:00" },
  { startTime: "17:00", endTime: "18:00" },
];

function seriesBody(clientId: string, caregiverId: string, extra: Record<string, unknown> = {}) {
  return {
    clientId,
    caregiverId,
    startDate: "2026-11-01",
    endDate: "2026-11-15",
    timeSlots: twiceDaily,
    description: "Morning and evening support",
    ...extra,
  };
}

function visitBody(clientId: string, caregiverId: string, scheduledDate: string, startTime: string, endTime: string) {
  return { clientId, caregiverId, scheduledDate, startTime, endTime, description: "One-off visit" };
}

describe("visit series", () => {
  it("schedules two visits a day with the same client from 1 to 15 November", async () => {
    const { token, caregiver, client } = await setup();

    const created = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id));
    expect(created.status).toBe(200);
    expect(created.body.data.createdCount).toBe(30);
    expect(created.body.data.series).toMatchObject({
      startDate: "2026-11-01",
      endDate: "2026-11-15",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      dates: null,
      timeSlots: twiceDaily,
      locationStreet: "1284 Maple Street",
      status: "active",
    });

    const schedule = await request(app)
      .get("/api/v1/schedule")
      .query({ from: "2026-11-01", to: "2026-11-15", caregiverIds: caregiver.id })
      .set(auth(token));
    expect(schedule.status).toBe(200);
    const days = schedule.body.data.caregivers[0].days;
    expect(days).toHaveLength(15);
    for (const day of days) {
      expect(day.visits.map((visit: { startTime: string }) => visit.startTime)).toEqual(["11:00", "17:00"]);
      expect(day.visits.every((visit: { clientId: string }) => visit.clientId === client.id)).toBe(true);
      expect(day.bookedMinutes).toBe(120);
    }

    const clash = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "2026-11-03", "11:30", "12:30"));
    expect(clash.status).toBe(422);
    expect(clash.body.message).toContain("already has a visit");
    expect(clash.body.conflicts[0]).toMatchObject({ date: "2026-11-03", existingStartTime: "11:00" });

    const between = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "2026-11-03", "13:00", "14:00"));
    expect(between.status).toBe(200);
  });

  it("reports clashing days and can skip them", async () => {
    const { token, caregiver, client } = await setup();
    const other = await createClientFor(caregiver.id, { firstName: "Mike", lastName: "Hussey" });
    await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(other.id, caregiver.id, "2026-11-05", "17:30", "18:30"))
      .expect(200);

    const rejected = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id));
    expect(rejected.status).toBe(422);
    expect(rejected.body.conflicts).toHaveLength(1);
    expect(rejected.body.conflicts[0]).toMatchObject({ date: "2026-11-05", startTime: "17:00", clientName: "Mike Hussey" });
    expect(await prisma.visitSeries.count()).toBe(0);

    const skipped = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id, { skipConflicts: true }));
    expect(skipped.status).toBe(200);
    expect(skipped.body.data.createdCount).toBe(29);
    expect(skipped.body.data.skipped).toHaveLength(1);
  });

  it("validates the range and the visit times", async () => {
    const { token, caregiver, client } = await setup();
    const tooLong = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id, { endDate: "2027-03-01" }));
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.errors.endDate).toBeDefined();

    const past = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id, { startDate: "2026-10-01" }));
    expect(past.status).toBe(422);

    const overlapping = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(
        seriesBody(client.id, caregiver.id, {
          timeSlots: [
            { startTime: "11:00", endTime: "12:00" },
            { startTime: "11:30", endTime: "13:00" },
          ],
        }),
      );
    expect(overlapping.status).toBe(422);
    expect(overlapping.body.errors.timeSlots).toBeDefined();
  });

  it("changes future visits, keeps edited ones, and does not recreate deleted ones", async () => {
    const { token, caregiver, client } = await setup();
    const created = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id, { weekdays: [1, 3, 5] }));
    expect(created.body.data.createdCount).toBe(12);
    const seriesId = created.body.data.series.id as string;

    const occurrences = await prisma.appointment.findMany({
      where: { seriesId },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    });
    const edited = occurrences.find(
      (row) => row.scheduledDate?.toISOString().startsWith("2026-11-11") && row.startTime === "11:00",
    )!;
    const deleted = occurrences.find(
      (row) => row.scheduledDate?.toISOString().startsWith("2026-11-13") && row.startTime === "17:00",
    )!;
    await request(app)
      .put(`/api/v1/appointments/${edited.id}`)
      .set(auth(token))
      .send({ startTime: "11:15", endTime: "12:15" })
      .expect(200);
    await request(app).delete(`/api/v1/appointments/${deleted.id}`).set(auth(token)).expect(200);

    const updated = await request(app)
      .put(`/api/v1/visit-series/${seriesId}`)
      .set(auth(token))
      .send({ fromDate: "2026-11-09", timeSlots: [{ startTime: "10:00", endTime: "11:00" }, twiceDaily[1]] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.fromDate).toBe("2026-11-09");

    const detail = await request(app).get(`/api/v1/visit-series/${seriesId}`).set(auth(token));
    const byDate = (date: string) =>
      detail.body.data.occurrences
        .filter((row: { date: string }) => row.date === date)
        .map((row: { startTime: string }) => row.startTime);
    expect(byDate("2026-11-02")).toEqual(["11:00", "17:00"]);
    expect(byDate("2026-11-09")).toEqual(["10:00", "17:00"]);
    expect(byDate("2026-11-11")).toEqual(["11:15", "17:00"]);
    expect(byDate("2026-11-13")).toEqual(["10:00"]);

    const ended = await request(app)
      .delete(`/api/v1/visit-series/${seriesId}`)
      .query({ fromDate: "2026-11-12" })
      .set(auth(token));
    expect(ended.status).toBe(200);
    expect(ended.body.data.series).toMatchObject({ status: "ended", endDate: "2026-11-11" });
    const remaining = await prisma.appointment.count({
      where: { seriesId, scheduledDate: { gte: new Date("2026-11-12T00:00:00.000Z") } },
    });
    expect(remaining).toBe(0);
  });

  it("schedules only the dates chosen on the calendar", async () => {
    const { token, caregiver, client } = await setup();
    const created = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send({
        clientId: client.id,
        caregiverId: caregiver.id,
        dates: ["2026-11-10", "2026-11-01", "2026-11-03"],
        timeSlots: twiceDaily,
        description: "Selected days",
      });
    expect(created.status).toBe(200);
    expect(created.body.data.createdCount).toBe(6);
    expect(created.body.data.series).toMatchObject({
      startDate: "2026-11-01",
      endDate: "2026-11-10",
      dates: ["2026-11-01", "2026-11-03", "2026-11-10"],
      weekdays: [0, 2],
    });

    const schedule = await request(app)
      .get("/api/v1/schedule")
      .query({ from: "2026-11-01", to: "2026-11-10", caregiverIds: caregiver.id })
      .set(auth(token));
    const visitsOn = (date: string) =>
      schedule.body.data.caregivers[0].days.find((day: { date: string }) => day.date === date).visits.length;
    expect(visitsOn("2026-11-01")).toBe(2);
    expect(visitsOn("2026-11-02")).toBe(0);
    expect(visitsOn("2026-11-03")).toBe(2);
    expect(visitsOn("2026-11-10")).toBe(2);

    const mixed = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id, { dates: ["2026-11-02"] }));
    expect(mixed.status).toBe(422);
    expect(mixed.body.errors.dates).toBeDefined();

    const past = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send({
        clientId: client.id,
        caregiverId: caregiver.id,
        dates: ["2026-10-01", "2026-11-01"],
        timeSlots: twiceDaily,
      });
    expect(past.status).toBe(422);
    expect(past.body.errors.dates).toBeDefined();
  });

  it("replaces future selected dates without turning them into a weekly repeat", async () => {
    const { token, caregiver, client } = await setup();
    const created = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send({
        clientId: client.id,
        caregiverId: caregiver.id,
        dates: ["2026-11-02", "2026-11-04", "2026-11-06"],
        timeSlots: twiceDaily,
      });
    expect(created.status).toBe(200);
    const seriesId = created.body.data.series.id as string;

    const rejected = await request(app)
      .put(`/api/v1/visit-series/${seriesId}`)
      .set(auth(token))
      .send({ weekdays: [1] });
    expect(rejected.status).toBe(422);
    expect(rejected.body.errors.dates).toBeDefined();

    const updated = await request(app)
      .put(`/api/v1/visit-series/${seriesId}`)
      .set(auth(token))
      .send({
        fromDate: "2026-11-04",
        dates: ["2026-11-02", "2026-11-06", "2026-11-18"],
        timeSlots: [{ startTime: "10:00", endTime: "11:00" }],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.series).toMatchObject({
      startDate: "2026-11-02",
      endDate: "2026-11-18",
      dates: ["2026-11-02", "2026-11-06", "2026-11-18"],
    });

    const detail = await request(app).get(`/api/v1/visit-series/${seriesId}`).set(auth(token));
    const byDate = (date: string) =>
      detail.body.data.occurrences
        .filter((row: { date: string }) => row.date === date)
        .map((row: { startTime: string }) => row.startTime);
    expect(byDate("2026-11-02")).toEqual(["11:00", "17:00"]);
    expect(byDate("2026-11-04")).toEqual([]);
    expect(byDate("2026-11-06")).toEqual(["10:00"]);
    expect(byDate("2026-11-18")).toEqual(["10:00"]);

    const repeat = await request(app)
      .post("/api/v1/visit-series")
      .set(auth(token))
      .send(seriesBody(client.id, caregiver.id, { startDate: "2026-11-20", endDate: "2026-11-22" }));
    const repeatUpdate = await request(app)
      .put(`/api/v1/visit-series/${repeat.body.data.series.id}`)
      .set(auth(token))
      .send({ dates: ["2026-11-21"] });
    expect(repeatUpdate.status).toBe(422);
    expect(repeatUpdate.body.errors.dates).toBeDefined();
  });
});

describe("availability and time off", () => {
  it("warns outside working hours and during time off until acknowledged", async () => {
    const { token, caregiver, client } = await setup();
    const saved = await request(app)
      .put(`/api/v1/users/caregivers/${caregiver.id}/availability`)
      .set(auth(token))
      .send({
        windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
          { weekday, startTime: "09:00", endTime: "13:00" },
          { weekday, startTime: "16:00", endTime: "19:00" },
        ]),
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.windows).toHaveLength(10);

    const saturday = visitBody(client.id, caregiver.id, "2026-11-07", "11:00", "12:00");
    const warned = await request(app).post("/api/v1/appointments").set(auth(token)).send(saturday);
    expect(warned.status).toBe(409);
    expect(warned.body.code).toBe("SCHEDULE_WARNING");
    expect(warned.body.warnings[0]).toMatchObject({ type: "outside_hours", date: "2026-11-07" });

    const booked = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send({ ...saturday, acknowledgeWarnings: true });
    expect(booked.status).toBe(200);
    expect(booked.body.data.warnings).toHaveLength(1);

    const weekday = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "2026-11-04", "17:00", "18:00"));
    expect(weekday.status).toBe(200);

    const off = await request(app)
      .post(`/api/v1/users/caregivers/${caregiver.id}/time-off`)
      .set(auth(token))
      .send({ startDate: "2026-11-04", reason: "Medical appointment" });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ allDay: true, startDate: "2026-11-04", endDate: "2026-11-04" });
    expect(off.body.data.affectedVisits).toHaveLength(1);

    const duringTimeOff = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "2026-11-04", "10:00", "11:00"));
    expect(duringTimeOff.status).toBe(409);
    expect(duringTimeOff.body.warnings[0]).toMatchObject({ type: "time_off", reason: "Medical appointment" });

    const day = await request(app)
      .get("/api/v1/schedule")
      .query({ from: "2026-11-02", to: "2026-11-04", caregiverIds: caregiver.id })
      .set(auth(token));
    const [monday, , wednesday] = day.body.data.caregivers[0].days;
    expect(monday.freeSlots).toEqual([
      { startTime: "09:00", endTime: "13:00" },
      { startTime: "16:00", endTime: "19:00" },
    ]);
    expect(monday.availableMinutes).toBe(420);
    expect(wednesday.availableMinutes).toBe(0);
    expect(wednesday.timeOff[0].allDay).toBe(true);

    const summary = await request(app)
      .get("/api/v1/schedule/summary")
      .query({ month: "2026-11" })
      .set(auth(token));
    expect(summary.status).toBe(200);
    const row = summary.body.data.caregivers.find((entry: { id: string }) => entry.id === caregiver.id);
    expect(row.days).toHaveLength(30);
    expect(row.days[3]).toMatchObject({ date: "2026-11-04", visitCount: 1, hasTimeOff: true, bookedMinutes: 60 });
    expect(row.days[6]).toMatchObject({ date: "2026-11-07", visitCount: 1, availableMinutes: 0 });

    const removed = await request(app)
      .delete(`/api/v1/users/caregivers/${caregiver.id}/time-off/${off.body.data.id}`)
      .set(auth(token));
    expect(removed.status).toBe(200);
  });

  it("rejects overlapping availability windows and bad ranges", async () => {
    const { token, caregiver } = await setup();
    const overlapping = await request(app)
      .put(`/api/v1/users/caregivers/${caregiver.id}/availability`)
      .set(auth(token))
      .send({
        windows: [
          { weekday: 1, startTime: "09:00", endTime: "13:00" },
          { weekday: 1, startTime: "12:00", endTime: "15:00" },
        ],
      });
    expect(overlapping.status).toBe(422);

    const longRange = await request(app)
      .get("/api/v1/schedule")
      .query({ from: "2026-11-01", to: "2026-12-15" })
      .set(auth(token));
    expect(longRange.status).toBe(422);

    const session = await login(app, caregiver.email);
    const forbidden = await request(app)
      .get("/api/v1/schedule")
      .query({ from: "2026-11-01", to: "2026-11-02" })
      .set(auth(session.body.data.accessToken));
    expect(forbidden.status).toBe(403);
  });
});

describe("check-in with two visits on the same day", () => {
  it("checks in to the earliest open visit when the app sends no appointmentId", async () => {
    const caregiver = await createUser({ email: "alex.rivera@example.com" });
    const client = await createClientFor(caregiver.id);
    const plan = await createPlan(client.id);
    const morning = await createAppointment({ clientId: client.id, caregiverId: caregiver.id, scheduledDate: TODAY });
    const evening = await createAppointment({ clientId: client.id, caregiverId: caregiver.id, scheduledDate: TODAY });
    await prisma.appointment.update({
      where: { id: evening.id },
      data: { startTime: "17:00", endTime: "18:00", durationMinutes: 60 },
    });
    const session = await login(app, caregiver.email);
    const token = session.body.data.accessToken as string;

    const first = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody(TODAY));
    expect(first.status).toBe(200);
    expect(first.body.data.id).toBe(morning.id);

    const second = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody(TODAY));
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(evening.id);

    const third = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody(TODAY));
    expect(third.status).toBe(422);
  });
});
