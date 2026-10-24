import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { setClock } from "../src/lib/clock";
import {
  TODAY,
  assertNoForbiddenKeys,
  assertStringIds,
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

async function session() {
  const caregiver = await createUser({ email: "alex.rivera@example.com", firstName: "Alex", lastName: "Rivera" });
  const other = await createUser({ email: "blair@example.com", firstName: "Blair", lastName: "Nguyen" });
  const signedIn = await login(app, caregiver.email);
  return {
    caregiver,
    other,
    token: signedIn.body.data.accessToken as string,
  };
}

describe("clients", () => {
  it("returns the double-nested page and hides another caregiver", async () => {
    const { caregiver, other, token } = await session();
    for (let index = 0; index < 11; index += 1) {
      await createClientFor(caregiver.id, {
        firstName: `First${String(index).padStart(2, "0")}`,
        lastName: `Last${String(index).padStart(2, "0")}`,
        email: index === 10 ? null : `client${index}@example.com`,
      });
    }
    await createClientFor(other.id, { firstName: "Hidden", lastName: "Client" });

    const page1 = await request(app)
      .get(`/api/v1/clients/caregiver/${caregiver.id}`)
      .query({ page: "1", pageSize: "10", status: "active" })
      .set(auth(token));
    expect(page1.status).toBe(200);
    expect(Array.isArray(page1.body.data)).toBe(false);
    expect(page1.body.data.data).toHaveLength(10);
    expect(page1.body.data.meta).toEqual({
      total: 11,
      page: 1,
      pageSize: 10,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(typeof page1.body.data.meta.total).toBe("number");
    expect(typeof page1.body.data.meta.hasNextPage).toBe("boolean");

    const page2 = await request(app)
      .get(`/api/v1/clients/caregiver/${caregiver.id}`)
      .query({ page: "2", pageSize: "10", status: "active" })
      .set(auth(token));
    expect(page2.body.data.data).toHaveLength(1);
    expect(page2.body.data.data[0].lastName).toBe("Last10");
    expect(page2.body.data.meta.hasPreviousPage).toBe(true);
    expect(page2.body.data.meta.hasNextPage).toBe(false);

    const empty = await request(app)
      .get(`/api/v1/clients/caregiver/${caregiver.id}`)
      .query({ page: "1", pageSize: "10", status: "active", search: "zzzz" })
      .set(auth(token));
    expect(empty.body.data).toEqual({
      data: [],
      meta: { total: 0, page: 1, pageSize: 10, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    });

    const byName = await request(app)
      .get(`/api/v1/clients/caregiver/${caregiver.id}`)
      .query({ page: "1", pageSize: "10", status: "active", search: "first03 last03" })
      .set(auth(token));
    expect(byName.body.data.data).toHaveLength(1);
    expect(byName.body.data.data[0].firstName).toBe("First03");

    const hidden = await request(app)
      .get(`/api/v1/clients/caregiver/${other.id}`)
      .query({ page: "1", pageSize: "10", status: "active" })
      .set(auth(token));
    expect(hidden.status).toBe(404);
    expect(hidden.body.message).toBe("The requested resource was not found.");
  });

  it("returns the client profile without admin notes and includes a doctor visit", async () => {
    const { caregiver, other, token } = await session();
    const client = await createClientFor(caregiver.id, { withClinical: true, gender: "other", genderOtherNote: "Admin gender note" });
    const plan = await createPlan(client.id);
    await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
      endDate: "2026-11-02",
    });
    await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: "2026-10-24",
      appointmentType: "doctor_visit",
      description: "Follow-up with the family physician",
    });
    await prisma.appointment.updateMany({
      where: { appointmentType: "doctor_visit" },
      data: {
        doctorName: "Dr. Priya Shah",
        doctorSpecialty: "Family medicine",
        doctorPhone: "(604) 555-2210",
        clinicName: "Example Family Clinic",
        startTime: "13:30",
        endTime: "14:00",
      },
    });
    const hidden = await createClientFor(other.id, { firstName: "Other", lastName: "Person" });

    const response = await request(app).get(`/api/v1/clients/${client.id}`).set(auth(token));
    expect(response.status).toBe(200);
    expect(response.body.data.address.street).toBe("1284 Maple Street");
    expect(response.body.data.gender).toBe("other");
    expect(response.body.data.languages[0].proficiency).toBe("other");
    expect(response.body.data.diagnoses[0].severity).toBe("other");
    expect(response.body.data.diagnoses[0].notes).toBe("Controlled with daily medication.");
    expect(response.body.data.hazards[0].type).toBe("other");
    expect(response.body.data.carePlans[0].tasks[0].completedToday).toBe(false);
    expect(response.body.data.serviceRequirements).toEqual([
      expect.objectContaining({
        category: "personal_care",
        name: "personal_care",
        isActive: true,
        clientId: client.id,
      }),
    ]);
    const doctor = response.body.data.appointments.find(
      (appointment: { appointmentType: string }) => appointment.appointmentType === "doctor_visit",
    );
    expect(doctor).toMatchObject({
      doctorName: "Dr. Priya Shah",
      doctorSpecialty: "Family medicine",
      doctorPhone: "(604) 555-2210",
      clinicName: "Example Family Clinic",
    });
    const ordinary = response.body.data.appointments.find(
      (appointment: { appointmentType: string }) => appointment.appointmentType === "personal_care",
    );
    expect(ordinary.doctorName).toBeUndefined();
    assertNoForbiddenKeys(response.body);
    assertStringIds(response.body.data);

    const missing = await request(app).get(`/api/v1/clients/${hidden.id}`).set(auth(token));
    expect(missing.status).toBe(404);
    const unknown = await request(app)
      .get("/api/v1/clients/00000000-0000-4000-8000-000000009999")
      .set(auth(token));
    expect(unknown.status).toBe(404);
  });

  it("rejects an invalid clients query", async () => {
    const { caregiver, token } = await session();
    const response = await request(app)
      .get(`/api/v1/clients/caregiver/${caregiver.id}`)
      .query({ page: "0", pageSize: "nope" })
      .set(auth(token));
    expect(response.status).toBe(422);
    expect(response.body.errors.page).toEqual(expect.any(Array));
    expect(response.body.errors.pageSize).toEqual(expect.any(Array));
  });
});

describe("appointments", () => {
  it("returns an array with both status fields and a full client embed", async () => {
    const { caregiver, other, token } = await session();
    const client = await createClientFor(caregiver.id, { withClinical: true });
    const plan = await createPlan(client.id);
    const today = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
      endDate: "2026-11-02",
      appointmentType: "other",
      appointmentTypeOtherNote: "Admin appointment note",
    });
    await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: "2026-10-20",
      endDate: "2026-10-20",
    });
    const hidden = await createAppointment({
      clientId: (await createClientFor(other.id)).id,
      caregiverId: other.id,
      scheduledDate: TODAY,
    });

    const list = await request(app).get(`/api/v1/appointments/caregiver/${caregiver.id}`).set(auth(token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].meta).toBeUndefined();
    const row = list.body.data.find((appointment: { id: string }) => appointment.id === today.id);
    expect(row.appointmentStatus).toBe("scheduled");
    expect(row.status).toBe("active");
    expect(row.completedToday).toBe(false);
    expect(row.activeToday).toBe(true);
    expect(row.dailyVisitStatus).toBe("pending");
    expect(row.locationGateCode).toBe("4821");
    expect(row.startTime).toBe("09:00");
    expect(row.duration).toBe(90);
    expect(row.client.carePlans[0].medications[0].medicationName).toBe("Lisinopril");
    expect(row.client.serviceRequirements[0].startTime).toBe("2026-09-19");
    expect(row.client.diagnoses).toBeUndefined();
    expect(row.caregiver).toEqual({
      firstName: "Alex",
      lastName: "Rivera",
      phone: "(604) 555-0148",
      email: caregiver.email,
    });
    assertNoForbiddenKeys(list.body);
    assertStringIds(list.body.data);
    const future = list.body.data.find((appointment: { scheduledDate: string }) => appointment.scheduledDate === "2026-10-20");
    expect(future.activeToday).toBe(false);
    expect(future.locationGateCode).toBe("4821");

    const detail = await request(app).get(`/api/v1/appointments/${today.id}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(today.id);
    expect(detail.body.data.client.carePlans[0].id).toBe(plan.id);

    expect((await request(app).get(`/api/v1/appointments/${hidden.id}`).set(auth(token))).status).toBe(404);
    expect(
      (await request(app).get(`/api/v1/appointments/caregiver/${other.id}`).set(auth(token))).status,
    ).toBe(404);
    const emptyCaregiver = await createUser({ email: "empty@example.com" });
    const emptySession = await login(app, emptyCaregiver.email);
    const empty = await request(app)
      .get(`/api/v1/appointments/caregiver/${emptyCaregiver.id}`)
      .set(auth(emptySession.body.data.accessToken));
    expect(empty.body.data).toEqual([]);
  });

  it("changes activeToday across the Vancouver date boundary", async () => {
    const { caregiver, token } = await session();
    const client = await createClientFor(caregiver.id);
    await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: "2026-10-20",
      endDate: "2026-10-20",
    });
    setClock({ now: () => new Date("2026-10-20T06:30:00.000Z") });

    const vancouver = await request(app)
      .get(`/api/v1/appointments/caregiver/${caregiver.id}`)
      .set(auth(token))
      .set("X-Timezone", "America/Vancouver");
    expect(vancouver.body.data[0]).toMatchObject({ activeToday: false, completedToday: false, locationGateCode: "4821" });

    const missing = await request(app).get(`/api/v1/appointments/caregiver/${caregiver.id}`).set(auth(token));
    expect(missing.body.data[0].activeToday).toBe(false);

    const invalid = await request(app)
      .get(`/api/v1/appointments/caregiver/${caregiver.id}`)
      .set(auth(token))
      .set("X-Timezone", "Not/AZone");
    expect(invalid.body.data[0].activeToday).toBe(false);

    const auckland = await request(app)
      .get(`/api/v1/appointments/caregiver/${caregiver.id}`)
      .set(auth(token))
      .set("X-Timezone", "Pacific/Auckland");
    expect(auckland.body.data[0].activeToday).toBe(true);
  });

  it("cancels without a reason and stores a reason when one is sent", async () => {
    const { caregiver, token } = await session();
    const client = await createClientFor(caregiver.id, { withClinical: true });
    const plan = await createPlan(client.id);
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
      endDate: "2026-11-02",
    });

    const otherStatus = await request(app)
      .put(`/api/v1/appointments/${appointment.id}`)
      .set(auth(token))
      .send({ appointmentStatus: "completed", cancellationReason: "Not a cancel" });
    expect(otherStatus.status).toBe(422);
    expect(otherStatus.body.errors.appointmentStatus[0]).toContain("cancelled");

    const cancelled = await request(app)
      .put(`/api/v1/appointments/${appointment.id}`)
      .set(auth(token))
      .send({ appointmentStatus: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      id: appointment.id,
      appointmentStatus: "cancelled",
      status: "active",
      dailyVisitStatus: "cancelled",
      activeToday: false,
      completedToday: false,
      notes: "Family may call during the visit.",
      clientId: client.id,
      caregiverId: caregiver.id,
      locationStreet: "1284 Maple Street",
      startTime: "09:00",
      endTime: "10:30",
    });
    const stored = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(stored?.notes).toBe("Family may call during the visit.");
    expect(stored?.clientId).toBe(client.id);
    expect(stored?.caregiverId).toBe(caregiver.id);
    expect(stored?.locationStreet).toBe("1284 Maple Street");
    expect(stored?.startTime).toBe("09:00");

    const withReasonVisit = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      carePlanId: plan.id,
      scheduledDate: "2026-10-21",
      endDate: "2026-10-21",
    });
    const withReason = await request(app)
      .put(`/api/v1/appointments/${withReasonVisit.id}`)
      .set(auth(token))
      .send({ appointmentStatus: "cancelled", cancellationReason: "  Family requested a different day.  " });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data).toMatchObject({
      id: withReasonVisit.id,
      appointmentStatus: "cancelled",
      cancellationReason: "Family requested a different day.",
      status: "active",
      dailyVisitStatus: "cancelled",
    });
    const again = await request(app).get(`/api/v1/appointments/${withReasonVisit.id}`).set(auth(token));
    expect(again.body.data.appointmentStatus).toBe("cancelled");
    expect(again.body.data.dailyVisitStatus).toBe("cancelled");
  });
});

describe("care plans and daily completion", () => {
  async function visit() {
    const people = await session();
    const client = await createClientFor(people.caregiver.id, { withClinical: true });
    const plan = await createPlan(client.id);
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: people.caregiver.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
      endDate: "2026-11-02",
    });
    return { ...people, client, plan, appointment };
  }

  it("checks in to the matching appointment and moves on to the next open visit that day", async () => {
    const { token, plan, appointment, caregiver, other } = await visit();
    const future = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody("2026-10-20"));
    expect(future.status).toBe(422);

    const response = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody());
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(appointment.id);
    expect(response.body.data.checkInTime).toBe("2026-10-19T16:05:00.000Z");
    expect(response.body.data.dailyVisitStatus).toBe("pending");
    expect(response.body.data.activeToday).toBe(true);
    expect(response.body.data.completedToday).toBe(false);
    expect(response.body.data.appointmentStatus).toBe("scheduled");

    const fetched = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(fetched.body.data.checkInTime).toBe("2026-10-19T16:05:00.000Z");
    expect(fetched.body.data.dailyVisitStatus).toBe("pending");

    const second = await createAppointment({
      clientId: appointment.clientId,
      caregiverId: caregiver.id,
      scheduledDate: TODAY,
      endDate: TODAY,
    });
    const next = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody("2026-10-19"));
    expect(next.status).toBe(200);
    expect(next.body.data.id).toBe(second.id);

    const allClosed = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody("2026-10-19"));
    expect(allClosed.status).toBe(422);
    expect(allClosed.body.errors.appointmentId).toEqual(expect.any(Array));

    const repeated = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody(TODAY, second.id));
    expect(repeated.status).toBe(409);
    expect(await prisma.carePlanCheckIn.count({ where: { appointmentId: second.id } })).toBe(1);

    const foreignPlan = await createPlan((await createClientFor(other.id)).id);
    const foreign = await request(app)
      .post(`/api/v1/care-plans/${foreignPlan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody());
    expect(foreign.status).toBe(404);
    expect(await prisma.carePlanCheckIn.count({ where: { carePlanId: foreignPlan.id } })).toBe(0);

    const foreignAppointment = await createAppointment({
      clientId: foreignPlan.clientId,
      caregiverId: other.id,
      scheduledDate: TODAY,
    });
    const bypass = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody(TODAY, foreignAppointment.id));
    expect(bypass.status).toBe(404);
    expect(await prisma.carePlanCheckIn.count({ where: { appointmentId: foreignAppointment.id } })).toBe(0);

    const none = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send(checkInBody("2026-12-01"));
    expect(none.status).toBe(422);
  });

  it("toggles checklist items and completes a day once", async () => {
    const { token, plan, appointment } = await visit();
    const beforeCheckIn = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/completions/toggle`)
      .set(auth(token))
      .send({ itemType: "task", itemId: plan.tasks[0].id, date: TODAY });
    expect(beforeCheckIn.status).toBe(422);

    await request(app).post(`/api/v1/care-plans/${plan.id}/check-in`).set(auth(token)).send(checkInBody());

    const blocked = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/daily-completion/toggle`)
      .set(auth(token))
      .send({ date: TODAY });
    expect(blocked.status).toBe(422);

    const items = [
      { itemType: "task", itemId: plan.tasks[0].id },
      { itemType: "medication", itemId: plan.medications[0].id },
      { itemType: "diet", itemId: plan.diet[0].id },
      { itemType: "hygiene", itemId: plan.hygiene[0].id },
    ];
    for (const item of items) {
      const toggled = await request(app)
        .post(`/api/v1/care-plans/${plan.id}/completions/toggle`)
        .set(auth(token))
        .send({ ...item, date: TODAY });
      expect(toggled.status).toBe(200);
      expect(toggled.body.data).toEqual({ completed: true });
    }

    const on = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(on.body.data.client.carePlans[0].tasks[0].completedToday).toBe(true);
    expect(on.body.data.client.carePlans[0].medications[0].completedToday).toBe(true);

    const off = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/completions/toggle`)
      .set(auth(token))
      .send({ itemType: "task", itemId: plan.tasks[0].id, date: TODAY });
    expect(off.body.data.completed).toBe(false);
    const offRead = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(offRead.body.data.client.carePlans[0].tasks[0].completedToday).toBe(false);

    await request(app)
      .post(`/api/v1/care-plans/${plan.id}/completions/toggle`)
      .set(auth(token))
      .send({ itemType: "task", itemId: plan.tasks[0].id, date: TODAY });

    const completed = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/daily-completion/toggle`)
      .set(auth(token))
      .send({ date: TODAY });
    expect(completed.status).toBe(200);
    expect(completed.body.data).toEqual({ appointmentId: appointment.id, date: TODAY, completed: true });

    const after = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(after.body.data).toMatchObject({
      completedToday: true,
      dailyVisitStatus: "completed",
      activeToday: false,
      appointmentStatus: "scheduled",
    });
    expect(after.body.data.checkOutTime).toEqual(expect.any(String));

    const repeat = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/daily-completion/toggle`)
      .set(auth(token))
      .send({ date: TODAY });
    expect(repeat.body.data.completed).toBe(true);
    const still = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(still.body.data.completedToday).toBe(true);
    expect(still.body.data.dailyVisitStatus).toBe("completed");
    expect(still.body.data.appointmentStatus).toBe("scheduled");

    const unknownItem = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/completions/toggle`)
      .set(auth(token))
      .send({ itemType: "task", itemId: "00000000-0000-4000-8000-00000000abcd", date: TODAY });
    expect(unknownItem.status).toBe(422);
  });

  it("completes a single-day visit and leaves a past day off the completed-today flag", async () => {
    const { caregiver, token } = await session();
    const client = await createClientFor(caregiver.id);
    const plan = await createPlan(client.id, { withItems: false });
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
      endDate: TODAY,
    });
    const completed = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/daily-completion/toggle`)
      .set(auth(token))
      .send({ date: TODAY });
    expect(completed.status).toBe(200);
    const sameDay = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(sameDay.body.data.appointmentStatus).toBe("completed");
    expect(sameDay.body.data.completedToday).toBe(true);

    setClock({ now: () => new Date("2026-10-20T18:00:00.000Z") });
    const nextDay = await request(app).get(`/api/v1/appointments/${appointment.id}`).set(auth(token));
    expect(nextDay.body.data).toMatchObject({
      appointmentStatus: "completed",
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: "completed",
    });
  });

  it("does not infer the service date from the UTC timestamp", async () => {
    const { token, plan, appointment } = await visit();
    const response = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(token))
      .send({
        timestamp: "2026-10-20T12:00:00.000Z",
        location: { latitude: 49.1, longitude: -122.8 },
        date: TODAY,
      });
    expect(response.status).toBe(200);
    const stored = await prisma.carePlanCheckIn.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(stored.serviceDate.toISOString().slice(0, 10)).toBe(TODAY);
    expect(response.body.data.dailyVisitStatus).toBe("pending");
  });
});

describe("malformed requests", () => {
  it("returns 400 for invalid JSON and 404 for an unknown path", async () => {
    const bad = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{");
    expect(bad.status).toBe(400);
    expect(typeof bad.body.message).toBe("string");

    const missing = await request(app).get("/api/v1/not-an-endpoint");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("NOT_FOUND");

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok", database: "up" });
  });
});
