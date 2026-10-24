import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  deliveringTransaction,
  queueNotificationPushes,
  setPushSender,
  type PushMessage,
  type PushSendResult,
} from "../src/services/push.service";
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
  testApp,
} from "./helpers";

const app = testApp();
const sent: PushMessage[] = [];

beforeEach(async () => {
  await prepare();
  sent.length = 0;
  setPushSender(async (messages) => {
    sent.push(...messages);
    return messages.map((message) => ({ token: message.token, errorCode: null }));
  });
});

afterEach(() => {
  setPushSender(null);
});

async function tokenFor(email: string) {
  const response = await login(app, email);
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("notification devices and push", () => {
  it("registers, moves, and removes a device without revealing another caregiver's token", async () => {
    const first = await createUser({ email: "first@example.com" });
    const second = await createUser({ email: "second@example.com" });
    const firstToken = await tokenFor(first.email);
    const secondToken = await tokenFor(second.email);

    const missing = await request(app)
      .post("/api/v1/notification-devices")
      .set(auth(firstToken))
      .send({ platform: "web" });
    expect(missing.status).toBe(422);
    expect(missing.body.errors.token).toEqual(expect.any(Array));
    expect(missing.body.errors.platform[0]).toContain("ios or android");

    const registered = await request(app)
      .post("/api/v1/notification-devices")
      .set(auth(firstToken))
      .send({ token: "  fcm-token-1  ", platform: "ios" });
    expect(registered.status).toBe(200);
    expect(registered.body.data).toMatchObject({
      token: "fcm-token-1",
      platform: "ios",
      caregiverId: first.id,
    });

    const moved = await request(app)
      .post("/api/v1/notification-devices")
      .set(auth(secondToken))
      .send({ token: "fcm-token-1", platform: "android" });
    expect(moved.status).toBe(200);
    expect(moved.body.data.id).toBe(registered.body.data.id);
    expect(moved.body.data.caregiverId).toBe(second.id);
    expect(moved.body.data.platform).toBe("android");
    expect(await prisma.notificationDevice.count({ where: { token: "fcm-token-1" } })).toBe(1);

    const hidden = await request(app)
      .delete("/api/v1/notification-devices")
      .set(auth(firstToken))
      .send({ token: "fcm-token-1" });
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toEqual({ deleted: false });
    expect(await prisma.notificationDevice.count({ where: { token: "fcm-token-1" } })).toBe(1);

    const unknown = await request(app)
      .delete("/api/v1/notification-devices")
      .set(auth(secondToken))
      .send({ token: "missing-token" });
    expect(unknown.body.data).toEqual({ deleted: false });

    const removed = await request(app)
      .delete("/api/v1/notification-devices")
      .set(auth(secondToken))
      .send({ token: "fcm-token-1" });
    expect(removed.body.data).toEqual({ deleted: true });
    expect(await prisma.notificationDevice.count()).toBe(0);
  });

  it("sends the stored notification to each registered token and keeps the visit offer when push fails", async () => {
    const owner = await createUser({ email: "owner@example.com", firstName: "Alex", lastName: "Rivera" });
    const cover = await createUser({ email: "cover@example.com", firstName: "Casey", lastName: "Singh" });
    const busy = await createUser({ email: "busy@example.com", firstName: "Blair", lastName: "Nguyen" });
    const client = await createClientFor(owner.id, { firstName: "Margaret", lastName: "Chen" });
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: TODAY,
    });
    const ownerToken = await tokenFor(owner.email);
    const coverToken = await tokenFor(cover.email);
    await prisma.notificationDevice.createMany({
      data: [
        { id: "00000000-0000-4000-8000-000000000001", caregiverId: owner.id, token: "owner-phone", platform: "ios" },
        { id: "00000000-0000-4000-8000-000000000002", caregiverId: cover.id, token: "cover-phone", platform: "ios" },
        { id: "00000000-0000-4000-8000-000000000003", caregiverId: cover.id, token: "cover-tablet", platform: "android" },
        { id: "00000000-0000-4000-8000-000000000004", caregiverId: busy.id, token: "busy-phone", platform: "android" },
      ],
    });

    const offered = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "I am unwell" });
    expect(offered.status).toBe(200);
    const releaseId = offered.body.data.release.id as string;
    const requested = sent.filter((message) => message.data.type === "appointment_coverage_requested");
    expect(requested.map((message) => message.token).sort()).toEqual(["busy-phone", "cover-phone", "cover-tablet"]);
    expect(requested.every((message) => message.token !== "owner-phone")).toBe(true);
    expect(requested[0].notification.title).toBe("A visit needs coverage");
    expect(requested[0].notification.body).toContain("I am unwell");
    expect(requested[0].data).toMatchObject({
      type: "appointment_coverage_requested",
      releaseId,
      appointmentId: appointment.id,
      title: requested[0].notification.title,
      body: requested[0].notification.body,
    });
    expect(requested[0].data.notificationId).toEqual(expect.any(String));
    expect(Object.values(requested[0].data).every((value) => value !== "")).toBe(true);
    expect(requested[0].android).toEqual({
      priority: "high",
      notification: { channelId: "coverage_notifications", sound: "default" },
    });
    expect(requested[0].apns).toEqual({
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", badge: 1 } },
    });
    expect(requested.every((message) => message.apns.payload.aps.badge === 1)).toBe(true);

    sent.length = 0;
    const accepted = await request(app).post(`/api/v1/appointment-coverage/${releaseId}/accept`).set(auth(coverToken));
    expect(accepted.status).toBe(200);
    const byToken = new Map(sent.map((message) => [message.token, message.data.type]));
    expect(byToken.get("owner-phone")).toBe("appointment_coverage_accepted");
    expect(byToken.get("cover-phone")).toBe("appointment_coverage_assigned");
    expect(byToken.get("cover-tablet")).toBe("appointment_coverage_assigned");
    expect(byToken.get("busy-phone")).toBe("appointment_coverage_taken");
    expect(sent.find((message) => message.token === "owner-phone")?.data.releaseId).toBe(releaseId);

    const notes = await request(app).get("/api/v1/notifications").set(auth(ownerToken));
    expect(notes.body.data.notifications[0].type).toBe("appointment_coverage_accepted");
    expect(notes.body.data.notifications[0].title).toBe(
      sent.find((message) => message.token === "owner-phone")?.notification.title,
    );
  });

  it("drops an invalid token, survives a push exception, and removes tokens on logout and deactivation", async () => {
    const owner = await createUser({ email: "owner@example.com" });
    const other = await createUser({ email: "other@example.com" });
    const third = await createUser({ email: "third@example.com" });
    const client = await createClientFor(owner.id);
    const plan = await createPlan(client.id, { withItems: false });
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      carePlanId: plan.id,
      scheduledDate: TODAY,
    });
    const later = await createAppointment({
      clientId: client.id,
      caregiverId: owner.id,
      scheduledDate: "2026-10-20",
    });
    const ownerToken = await tokenFor(owner.email);
    const otherToken = await tokenFor(other.email);
    await prisma.notificationDevice.createMany({
      data: [
        { id: "00000000-0000-4000-8000-000000000011", caregiverId: other.id, token: "stale-phone", platform: "ios" },
        { id: "00000000-0000-4000-8000-000000000012", caregiverId: other.id, token: "good-phone", platform: "android" },
        { id: "00000000-0000-4000-8000-000000000013", caregiverId: third.id, token: "third-phone", platform: "ios" },
      ],
    });
    setPushSender(async (messages) => {
      sent.push(...messages);
      return messages.map(
        (message): PushSendResult => ({
          token: message.token,
          errorCode: message.token === "stale-phone" ? "messaging/registration-token-not-registered" : null,
        }),
      );
    });

    const offered = await request(app)
      .post(`/api/v1/appointments/${appointment.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Running late" });
    expect(offered.status).toBe(200);
    expect(await prisma.notificationDevice.findUnique({ where: { token: "stale-phone" } })).toBeNull();
    expect(await prisma.notificationDevice.findUnique({ where: { token: "good-phone" } })).not.toBeNull();

    const checked = await request(app)
      .post(`/api/v1/care-plans/${plan.id}/check-in`)
      .set(auth(ownerToken))
      .send(checkInBody(TODAY, appointment.id));
    expect(checked.status).toBe(200);
    expect(
      sent.some(
        (message) =>
          message.data.type === "appointment_coverage_unavailable" && message.notification.body.includes("has started"),
      ),
    ).toBe(true);

    setPushSender(async () => {
      throw new Error("FCM unavailable");
    });
    const second = await request(app)
      .post(`/api/v1/appointments/${later.id}/coverage`)
      .set(auth(ownerToken))
      .send({ reason: "Still away" });
    expect(second.status).toBe(200);
    const saved = await prisma.notification.findFirst({
      where: { userId: other.id, appointmentId: later.id, type: "appointment_coverage_requested" },
    });
    expect(saved).not.toBeNull();

    const loggedOut = await request(app).post("/api/v1/auth/logout").set(auth(otherToken));
    expect(loggedOut.status).toBe(200);
    expect(await prisma.notificationDevice.count({ where: { caregiverId: other.id } })).toBe(0);
    expect(await prisma.notificationDevice.count({ where: { caregiverId: third.id } })).toBe(1);

    const admin = await createUser({ role: "ADMIN", email: "staff@example.com" });
    const adminLogin = await request(app).post("/api/v1/admin/auth/login").send({
      email: admin.email,
      password: PASSWORD,
    });
    const deactivated = await request(app)
      .post(`/api/v1/users/caregivers/${third.id}/deactivate`)
      .set(auth(adminLogin.body.data.accessToken as string));
    expect(deactivated.status).toBe(200);
    expect(await prisma.notificationDevice.count({ where: { caregiverId: third.id } })).toBe(0);
  });

  it("omits data keys that have no value and badges the caregiver's unread count", async () => {
    const caregiver = await createUser({ email: "badge@example.com" });
    await prisma.notificationDevice.create({
      data: {
        id: "00000000-0000-4000-8000-000000000021",
        caregiverId: caregiver.id,
        token: "badge-phone",
        platform: "ios",
      },
    });
    await prisma.notification.create({
      data: {
        id: randomUUID(),
        userId: caregiver.id,
        type: "appointment_coverage_requested",
        title: "Already waiting",
        body: "An older notice is still unread.",
        readAt: null,
      },
    });

    await deliveringTransaction(async (tx) => {
      const id = randomUUID();
      await tx.notification.create({
        data: {
          id,
          userId: caregiver.id,
          type: "appointment_coverage_requested",
          title: "Coverage needed",
          body: "A visit needs a caregiver.",
          appointmentId: null,
          releaseId: null,
        },
      });
      queueNotificationPushes([id]);
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].notification).toEqual({
      title: "Coverage needed",
      body: "A visit needs a caregiver.",
    });
    expect(sent[0].data).toEqual({
      notificationId: expect.any(String),
      type: "appointment_coverage_requested",
      title: "Coverage needed",
      body: "A visit needs a caregiver.",
    });
    expect(sent[0].data).not.toHaveProperty("releaseId");
    expect(sent[0].data).not.toHaveProperty("appointmentId");
    expect(sent[0].apns.payload.aps.badge).toBe(2);
  });
});
