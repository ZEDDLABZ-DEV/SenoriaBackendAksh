import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, zonedDateTimeToUtc } from "../src/lib/timezone";
import { prisma } from "../src/lib/prisma";
import {
  APPOINTMENT_REMINDER_TYPES,
  processAppointmentReminders,
} from "../src/services/appointmentReminder.service";
import { setPushSender, type PushMessage } from "../src/services/push.service";
import {
  TODAY,
  auth,
  createAppointment,
  createClientFor,
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

describe("appointment visit reminders", () => {
  it("fires check-in reminders 15 minutes before and at visit start", async () => {
    const caregiver = await createUser({ email: "caregiver@example.com" });
    const client = await createClientFor(caregiver.id, { firstName: "Margaret", lastName: "Chen" });
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: TODAY,
    });
    await prisma.notificationDevice.create({
      data: {
        id: "00000000-0000-4000-8000-000000000101",
        caregiverId: caregiver.id,
        token: "caregiver-phone",
        platform: "ios",
      },
    });

    const fifteenBefore = zonedDateTimeToUtc(TODAY, "08:45", DEFAULT_TIME_ZONE);
    const first = await processAppointmentReminders({ at: fifteenBefore });
    expect(first.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].data.type).toBe(APPOINTMENT_REMINDER_TYPES.checkIn15m);
    expect(sent[0].notification.title).toBe("Visit starting soon");
    expect(sent[0].data.appointmentId).toBe(appointment.id);

    const atStart = zonedDateTimeToUtc(TODAY, "09:00", DEFAULT_TIME_ZONE);
    const second = await processAppointmentReminders({ at: atStart });
    expect(second.sent).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].data.type).toBe(APPOINTMENT_REMINDER_TYPES.checkInStart);

    const again = await processAppointmentReminders({ at: atStart });
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("fires check-out reminders 15 minutes before and at visit end", async () => {
    const caregiver = await createUser({ email: "checkout@example.com" });
    const client = await createClientFor(caregiver.id, { firstName: "Margaret", lastName: "Chen" });
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: TODAY,
    });
    await prisma.notificationDevice.create({
      data: {
        id: "00000000-0000-4000-8000-000000000102",
        caregiverId: caregiver.id,
        token: "checkout-phone",
        platform: "android",
      },
    });

    const fifteenBeforeEnd = zonedDateTimeToUtc(TODAY, "10:15", DEFAULT_TIME_ZONE);
    const first = await processAppointmentReminders({ at: fifteenBeforeEnd });
    expect(first.sent).toBe(1);
    expect(sent[0].data.type).toBe(APPOINTMENT_REMINDER_TYPES.checkOut15m);
    expect(sent[0].notification.title).toBe("Visit ending soon");
    expect(sent[0].data.appointmentId).toBe(appointment.id);

    const atEnd = zonedDateTimeToUtc(TODAY, "10:30", DEFAULT_TIME_ZONE);
    const second = await processAppointmentReminders({ at: atEnd });
    expect(second.sent).toBe(1);
    expect(sent[1].data.type).toBe(APPOINTMENT_REMINDER_TYPES.checkOutEnd);
    expect(sent[1].notification.body).toContain("check out");
  });

  it("lists reminder notifications through GET /notifications", async () => {
    const caregiver = await createUser({ email: "list@example.com" });
    const client = await createClientFor(caregiver.id);
    await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: TODAY,
    });
    await prisma.notificationDevice.create({
      data: {
        id: "00000000-0000-4000-8000-000000000103",
        caregiverId: caregiver.id,
        token: "list-phone",
        platform: "ios",
      },
    });

    await processAppointmentReminders({
      at: zonedDateTimeToUtc(TODAY, "09:00", DEFAULT_TIME_ZONE),
    });

    const loginResponse = await login(app, caregiver.email);
    const token = loginResponse.body.data.accessToken as string;
    const response = await request(app).get("/api/v1/notifications").set(auth(token));
    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBeGreaterThanOrEqual(1);
    expect(response.body.data.notifications.some(
      (row: { type: string }) => row.type === APPOINTMENT_REMINDER_TYPES.checkInStart,
    )).toBe(true);
  });

  it("skips check-in reminders after the caregiver has already checked in", async () => {
    const caregiver = await createUser({ email: "checkedin@example.com" });
    const client = await createClientFor(caregiver.id);
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: TODAY,
    });
    await prisma.appointmentDailyVisit.create({
      data: {
        id: "00000000-0000-4000-8000-000000000104",
        appointmentId: appointment.id,
        serviceDate: new Date(`${TODAY}T00:00:00.000Z`),
        dailyVisitStatus: "in_progress",
        completed: false,
        active: true,
        checkInAt: new Date("2026-10-19T16:05:00.000Z"),
      },
    });

    const result = await processAppointmentReminders({
      at: zonedDateTimeToUtc(TODAY, "09:00", DEFAULT_TIME_ZONE),
    });
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
