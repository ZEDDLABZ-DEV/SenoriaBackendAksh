import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
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

async function tokenFor(email: string) {
  const response = await login(app, email);
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("appointment coverage", () => {
  it("notifies other caregivers, shows the full visit, and transfers it to the first accepter", async () => {
    const owner = await createUser({
      email: "owner@example.com",
      firstName: "Alex",
      lastName: "Rivera",
    });
    const busy = await createUser({
      email: "busy@example.com",
      firstName: "Blair",
      lastName: "Nguyen",
    });
    const cover = await createUser({
      email: "cover@example.com",
      firstName: "Casey",
      lastName: "Singh",
    });
    const admin = await createUser({ email: "admin@example.com", role: "ADMIN" });
    const inactive = await createUser({ email: "inactive@example.com", status: "inactive" });
    const client = await createClientFor(owner.id, { withClinical: true, firstName: "Margaret", lastName: "Chen" });
    const plan = await createPlan(client.id);
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
      description: "Morning personal care and medication.",
    });
    const busyClient = await createClientFor(busy.id, { firstName: "Helen", lastName: "Park" });
    await createAppointment({
      clientId: busyClient.id,
      caregiverId: busy.id,
      scheduledDate: TODAY,
    });
    await prisma.caregiverTimeOff.create({
      data: {
        id: randomUUID(),
        caregiverId: cover.id,
        startDate: new Date(`${TODAY}T00:00:00.000Z`),
        endDate: new Date(`${TODAY}T00:00:00.000Z`),
        reason: "Personal appointment",
      },
    });

    const ownerToken = await tokenFor(owner.email);
    const busyToken = await tokenFor(busy.email);
    const coverToken = await tokenFor(cover.email);

    const offered = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "  I am unwell  " });
    expect(offered.status).toBe(200);
    expect(offered.body.data.notifiedCount).toBe(2);
    expect(offered.body.data.release.status).toBe("open");
    expect(offered.body.data.release.reason).toBe("I am unwell");
    expect(offered.body.data.release.acceptedBy).toBeNull();
    expect(offered.body.data.appointment.caregiverId).toBe(owner.id);
    expect(offered.body.data.appointment.coverageRequest.reason).toBe("I am unwell");
    assertNoForbiddenKeys(offered.body);
    assertStringIds(offered.body.data);
    const releaseId = offered.body.data.release.id as string;

    const again = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Still unwell" });
    expect(again.status).toBe(409);

    const missingReason = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(coverToken))
      .send({});
    expect(missingReason.status).toBe(422);
    const foreign = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(coverToken))
      .send({ reason: "I can help" });
    expect(foreign.status).toBe(404);

    const open = await request(app).get("/api/v1/appointment-coverage/open").set(auth(coverToken));
    expect(open.status).toBe(200);
    expect(open.body.data).toHaveLength(1);
    expect(open.body.data[0].appointment.client).toEqual({
      id: client.id,
      firstName: "Margaret",
      lastName: "Chen",
    });
    expect(open.body.data[0].appointment.locationGateCode).toBeUndefined();
    expect(open.body.data[0].requestedBy).toMatchObject({ firstName: "Alex", lastName: "Rivera" });
    const ownerOpen = await request(app).get("/api/v1/appointment-coverage/open").set(auth(ownerToken));
    expect(ownerOpen.body.data).toEqual([]);
    const mine = await request(app).get("/api/v1/appointment-coverage/mine").set(auth(ownerToken));
    expect(mine.body.data).toHaveLength(1);

    const detail = await request(app).get(`/api/v1/appointment-coverage/${releaseId}`).set(auth(coverToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.appointment.instructions).toBe("Confirm breakfast before the morning tablets.");
    expect(detail.body.data.appointment.locationGateCode).toBe("4821");
    expect(detail.body.data.appointment.notes).toBe("Family may call during the visit.");
    expect(detail.body.data.appointment.tasks[0].name).toBe("Mobility walk");
    expect(detail.body.data.appointment.client.hazards[0].precautions).toBe("Stay within arm's reach.");
    expect(detail.body.data.appointment.client.emergencyContacts[0].phone).toBe("(604) 555-0102");
    assertNoForbiddenKeys(detail.body);

    const ownAccept = await request(app)
      .post(`/api/v1/appointment-coverage/${releaseId}/accept`)
      .set(auth(ownerToken));
    expect(ownAccept.status).toBe(409);
    expect(ownAccept.body.message).toContain("your own visit");

    const overlap = await request(app)
      .post(`/api/v1/appointment-coverage/${releaseId}/accept`)
      .set(auth(busyToken));
    expect(overlap.status).toBe(422);
    expect(overlap.body.message).toContain("already has a visit");
    expect(overlap.body.conflicts.length).toBeGreaterThan(0);

    const accepted = await request(app)
      .post(`/api/v1/appointment-coverage/${releaseId}/accept`)
      .set(auth(coverToken));
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.release.status).toBe("accepted");
    expect(accepted.body.data.release.acceptedBy.id).toBe(cover.id);
    expect(accepted.body.data.appointment.caregiverId).toBe(cover.id);
    expect(accepted.body.data.appointment.coverageRequest).toBeNull();
    expect(accepted.body.data.appointment.client.id).toBe(client.id);
    expect(accepted.body.data.appointment.locationNavigation).toBe("Use the side entrance. Ring the bell twice.");

    const taken = await request(app)
      .post(`/api/v1/appointment-coverage/${releaseId}/accept`)
      .set(auth(busyToken));
    expect(taken.status).toBe(409);
    expect(taken.body.message).toContain("already been taken");

    const ownerList = await request(app)
      .get(`/api/v1/appointments/caregiver/${owner.id}`)
      .set(auth(ownerToken));
    expect(ownerList.body.data.map((row: { id: string }) => row.id)).not.toContain(appointment.id);
    const coverList = await request(app)
      .get(`/api/v1/appointments/caregiver/${cover.id}`)
      .set(auth(coverToken));
    expect(coverList.body.data.map((row: { id: string }) => row.id)).toContain(appointment.id);
    const link = await prisma.caregiverClientAssignment.findUnique({
      where: { caregiverId_clientId: { caregiverId: cover.id, clientId: client.id } },
    });
    expect(link).not.toBeNull();

    const ownerNotes = await request(app).get("/api/v1/notifications").set(auth(ownerToken));
    expect(ownerNotes.body.data.unreadCount).toBe(1);
    expect(ownerNotes.body.data.notifications[0].type).toBe("appointment_coverage_accepted");
    expect(ownerNotes.body.data.notifications[0].body).toContain("Casey Singh");

    const busyNotes = await request(app).get("/api/v1/notifications").set(auth(busyToken));
    expect(busyNotes.body.data.notifications[0].type).toBe("appointment_coverage_taken");
    const coverNotes = await request(app).get("/api/v1/notifications?unread=true").set(auth(coverToken));
    expect(coverNotes.body.data.notifications[0].type).toBe("appointment_coverage_assigned");
    expect(coverNotes.body.data.unreadCount).toBe(1);

    const read = await request(app)
      .post(`/api/v1/notifications/${coverNotes.body.data.notifications[0].id}/read`)
      .set(auth(coverToken));
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).toEqual(expect.any(String));
    const hidden = await request(app)
      .post(`/api/v1/notifications/${coverNotes.body.data.notifications[0].id}/read`)
      .set(auth(busyToken));
    expect(hidden.status).toBe(404);
    const cleared = await request(app).post("/api/v1/notifications/read-all").set(auth(busyToken));
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.updatedCount).toBe(1);

    expect(await prisma.notification.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: inactive.id } })).toBe(0);
    const requested = await prisma.notification.findFirst({
      where: { userId: busy.id, type: "appointment_coverage_taken" },
    });
    expect(requested?.body).toContain("Margaret Chen");

    const stale = await request(app).get(`/api/v1/appointment-coverage/${releaseId}`).set(auth(busyToken));
    expect(stale.status).toBe(409);
    const kept = await request(app).get(`/api/v1/appointment-coverage/${releaseId}`).set(auth(coverToken));
    expect(kept.status).toBe(200);
    expect(kept.body.data.appointment.id).toBe(appointment.id);
  });

  it("lets the owner withdraw an offer and tells the other caregivers", async () => {
    const owner = await createUser({ email: "owner@example.com", firstName: "Alex", lastName: "Rivera" });
    const other = await createUser({ email: "other@example.com", firstName: "Blair", lastName: "Nguyen" });
    const client = await createClientFor(owner.id);
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: TODAY,
    });
    const ownerToken = await tokenFor(owner.email);
    const otherToken = await tokenFor(other.email);
    const offered = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Car trouble" });
    expect(offered.status).toBe(200);

    const withdrawn = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage/withdraw`)
      .set(auth(ownerToken));
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.release.status).toBe("withdrawn");
    expect(withdrawn.body.data.appointment.caregiverId).toBe(owner.id);
    expect(withdrawn.body.data.appointment.coverageRequest).toBeNull();

    const notes = await request(app).get("/api/v1/notifications").set(auth(otherToken));
    expect(notes.body.data.notifications[0].type).toBe("appointment_coverage_withdrawn");
    expect(notes.body.data.notifications[0].body).toContain("Alex Rivera");
    expect(notes.body.data.notifications[0].body).toContain("will keep");
    const board = await request(app).get("/api/v1/appointment-coverage/open").set(auth(otherToken));
    expect(board.body.data).toEqual([]);
    const accept = await request(app)
      .post(`/api/v1/appointment-coverage/${offered.body.data.release.id}/accept`)
      .set(auth(otherToken));
    expect(accept.status).toBe(409);

    const repeat = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage/withdraw`)
      .set(auth(ownerToken));
    expect(repeat.status).toBe(409);
  });

  it("closes the offer when the owner checks in or cancels", async () => {
    const owner = await createUser({ email: "owner@example.com" });
    const other = await createUser({ email: "other@example.com" });
    const client = await createClientFor(owner.id);
    const plan = await createPlan(client.id, { withItems: false });
    const started = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
    });
    const cancelled = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: "2026-10-20",
    });
    const ownerToken = await tokenFor(owner.email);
    const otherToken = await tokenFor(other.email);

    await request(app)
      .post(`/api/v1/appointments/${started.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Running late" });
    await request(app)
      .post(`/api/v1/appointments/${cancelled.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Family changed plans" });

    const checkIn = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(ownerToken))
      .send(checkInBody(TODAY, started.id));
    expect(checkIn.status).toBe(200);
    const cancel = await request(app)
      .put(`/api/v1/appointments/${cancelled.id}`)
      .set(auth(ownerToken))
      .send({ appointmentStatus: "cancelled", cancellationReason: "Family requested a different day." });
    expect(cancel.status).toBe(200);

    const notes = await request(app).get("/api/v1/notifications").set(auth(otherToken));
    const types = notes.body.data.notifications.map((row: { type: string; body: string }) => row.body);
    expect(types.some((body: string) => body.includes("has started"))).toBe(true);
    expect(types.some((body: string) => body.includes("was cancelled"))).toBe(true);
    const board = await request(app).get("/api/v1/appointment-coverage/open").set(auth(otherToken));
    expect(board.body.data).toEqual([]);
  });

  it("refuses a past, completed, or already started visit and marks a series visit as an exception", async () => {
    const owner = await createUser({ email: "owner@example.com" });
    const cover = await createUser({ email: "cover@example.com" });
    const client = await createClientFor(owner.id);
    const ownerToken = await tokenFor(owner.email);
    const coverToken = await tokenFor(cover.email);

    const past = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: "2026-10-18",
    });
    const pastOffer = await request(app)
      .post(`/api/v1/appointments/${past.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Too late" });
    expect(pastOffer.status).toBe(409);

    const done = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: TODAY,
      appointmentStatus: "completed",
    });
    const doneOffer = await request(app)
      .post(`/api/v1/appointments/${done.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Already finished" });
    expect(doneOffer.status).toBe(409);

    const series = await prisma.visitSeries.create({
      data: {
        id: randomUUID(),
        clientId: client.id,
        caregiverId: owner.id,
        startDate: new Date(`${TODAY}T00:00:00.000Z`),
        endDate: new Date(`${TODAY}T00:00:00.000Z`),
        weekdays: [1],
        timeSlots: [{ startTime: "09:00", endTime: "10:30" }],
        serviceIds: [],
        appointmentType: "personal_care",
        status: "active",
      },
    });
    const visit = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: "2026-10-21",
    });
    await prisma.appointment.update({
      where: { id: visit.id },
      data: {
        seriesId: series.id,
        seriesDate: new Date("2026-10-21T00:00:00.000Z"),
        seriesSlot: 0,
      },
    });
    const offered = await request(app)
      .post(`/api/v1/appointments/${visit.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Schedule conflict" });
    expect(offered.status).toBe(200);
    const accepted = await request(app)
      .post(`/api/v1/appointment-coverage/${offered.body.data.release.id}/accept`)
      .set(auth(coverToken));
    expect(accepted.status).toBe(200);
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: visit.id } });
    expect(stored.caregiverId).toBe(cover.id);
    expect(stored.isException).toBe(true);
    expect(stored.seriesId).toBe(series.id);
  });
});
