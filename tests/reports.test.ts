import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  PASSWORD,
  auth,
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
  const admin = await createUser({
    role: "ADMIN",
    email: "admin@example.com",
    firstName: "Ada",
    lastName: "Admin",
  });
  const response = await request(app).post("/api/v1/auth/login").send({
    email: admin.email,
    password: PASSWORD,
  });
  return { admin, token: response.body.data.accessToken as string };
}

async function seedDay() {
  const caregiver = await createUser({
    email: "caregiver@example.com",
    firstName: "Alex",
    lastName: "Rivera",
  });
  const client = await createClientFor(caregiver.id, { firstName: "Margaret", lastName: "Chen" });
  const plan = await createPlan(client.id);
  const completedAppointment = await createAppointment({
    clientId: client.id,
    caregiverId: caregiver.id,
    carePlanId: plan.id,
    scheduledDate: "2026-10-19",
    description: "Morning personal care",
  });
  const visit = await prisma.appointmentDailyVisit.create({
    data: {
      id: randomUUID(),
      appointmentId: completedAppointment.id,
      serviceDate: new Date("2026-10-19T00:00:00.000Z"),
      dailyVisitStatus: "completed",
      completed: true,
      active: false,
      checkInAt: new Date("2026-10-19T16:05:00.000Z"),
      checkOutAt: new Date("2026-10-19T20:00:00.000Z"),
    },
  });
  await prisma.careItemCompletion.create({
    data: {
      id: randomUUID(),
      carePlanId: plan.id,
      itemType: "task",
      itemId: plan.tasks[0].id,
      serviceDate: new Date("2026-10-19T00:00:00.000Z"),
      completed: true,
      caregiverId: caregiver.id,
    },
  });
  const pendingAppointment = await createAppointment({
    clientId: client.id,
    caregiverId: caregiver.id,
    carePlanId: plan.id,
    scheduledDate: "2026-10-19",
    description: "Afternoon check",
  });
  const pendingVisit = await prisma.appointmentDailyVisit.create({
    data: {
      id: randomUUID(),
      appointmentId: pendingAppointment.id,
      serviceDate: new Date("2026-10-19T00:00:00.000Z"),
      dailyVisitStatus: "pending",
      completed: false,
      active: true,
      checkInAt: new Date("2026-10-19T22:00:00.000Z"),
    },
  });
  await createAppointment({
    clientId: client.id,
    caregiverId: caregiver.id,
    carePlanId: plan.id,
    scheduledDate: "2026-10-19",
    appointmentStatus: "cancelled",
    description: "Cancelled visit",
  });
  await createAppointment({
    clientId: client.id,
    caregiverId: caregiver.id,
    carePlanId: plan.id,
    scheduledDate: "2026-10-18",
    description: "Yesterday",
  });
  return { caregiver, client, plan, visit, pendingVisit };
}

describe("visit reports", () => {
  it("lists a completed day with late arrival, checklist, and window totals", async () => {
    const { token } = await adminToken();
    const { caregiver, plan, visit } = await seedDay();

    const report = await request(app)
      .get("/api/v1/admin/reports/visits?period=daily&date=2026-10-19")
      .set(auth(token));
    expect(report.status).toBe(200);
    expect(report.body.data).toMatchObject({
      period: "daily",
      from: "2026-10-19",
      to: "2026-10-19",
      timeZone: "America/Vancouver",
      filters: { caregiverId: null, clientId: null, status: "completed" },
      summary: {
        scheduledDays: 2,
        completedDays: 1,
        pendingDays: 1,
        missedDays: 0,
        cancelledDays: 1,
        totalHours: 3.92,
        averageHours: 3.92,
        completionRate: 0.5,
      },
    });
    expect(report.body.data.meta.total).toBe(1);
    expect(report.body.data.data).toHaveLength(1);
    const row = report.body.data.data[0];
    expect(row).toMatchObject({
      dailyVisitId: visit.id,
      status: "completed",
      canAdjustHours: true,
      scheduledStartTime: "09:00",
      scheduledEndTime: "10:30",
      scheduledHours: 1.5,
      checkInAt: "2026-10-19T16:05:00.000Z",
      completedAt: "2026-10-19T20:00:00.000Z",
      originalHours: 3.92,
      adjustedHours: null,
      hoursUsed: 3.92,
      arrival: {
        status: "late",
        minutesLate: 5,
        minutesEarly: 0,
      },
      counts: {
        tasks: { completed: 1, total: 1 },
        medications: { completed: 0, total: 1 },
        diet: { completed: 0, total: 1 },
        hygiene: { completed: 0, total: 1 },
      },
    });
    const task = row.items.find((item: { itemType: string }) => item.itemType === "task");
    expect(task).toMatchObject({
      itemId: plan.tasks[0].id,
      name: "Mobility walk",
      completed: true,
      caregiver: { id: caregiver.id, firstName: "Alex", lastName: "Rivera" },
    });
    expect(task.completedAt).toEqual(expect.any(String));
    const medication = row.items.find((item: { itemType: string }) => item.itemType === "medication");
    expect(medication.completed).toBe(false);
    expect(medication.completedAt).toBeNull();

    const pending = await request(app)
      .get("/api/v1/admin/reports/visits?period=daily&date=2026-10-19&status=pending")
      .set(auth(token));
    expect(pending.body.data.data).toHaveLength(1);
    expect(pending.body.data.data[0].status).toBe("pending");
    expect(pending.body.data.data[0].canAdjustHours).toBe(false);
    expect(pending.body.data.summary.completedDays).toBe(1);

    const missed = await request(app)
      .get("/api/v1/admin/reports/visits?period=custom&from=2026-10-18&to=2026-10-19&status=missed")
      .set(auth(token));
    expect(missed.status).toBe(200);
    expect(missed.body.data.data).toHaveLength(1);
    expect(missed.body.data.data[0].serviceDate).toBe("2026-10-18");
    expect(missed.body.data.data[0].arrival.status).toBe("no_check_in");
  });

  it("keeps the original times when an admin corrects hours", async () => {
    const { admin, token } = await adminToken();
    const { visit, pendingVisit } = await seedDay();

    const first = await request(app)
      .post(`/api/v1/admin/reports/visits/${visit.id}/hours`)
      .set(auth(token))
      .send({ adjustedHours: 6.5, reason: "Forgot to check out" });
    expect(first.status).toBe(200);
    expect(first.body.message).toBe("Hours corrected");
    expect(first.body.data).toMatchObject({
      checkInAt: "2026-10-19T16:05:00.000Z",
      completedAt: "2026-10-19T20:00:00.000Z",
      originalHours: 3.92,
      adjustedHours: 6.5,
      hoursUsed: 6.5,
      arrival: { status: "late", minutesLate: 5 },
    });
    expect(first.body.data.adjustments).toHaveLength(1);
    expect(first.body.data.adjustments[0]).toMatchObject({
      adjustedHours: 6.5,
      reason: "Forgot to check out",
      admin: { id: admin.id, firstName: "Ada", lastName: "Admin" },
    });

    const second = await request(app)
      .post(`/api/v1/admin/reports/visits/${visit.id}/hours`)
      .set(auth(token))
      .send({ adjustedHours: 7.25, reason: "Family confirmed the later departure" });
    expect(second.status).toBe(200);
    expect(second.body.data.adjustedHours).toBe(7.25);
    expect(second.body.data.hoursUsed).toBe(7.25);
    expect(second.body.data.originalHours).toBe(3.92);
    expect(second.body.data.adjustments.map((entry: { adjustedHours: number }) => entry.adjustedHours)).toEqual([
      7.25,
      6.5,
    ]);

    const stored = await prisma.appointmentDailyVisit.findUniqueOrThrow({ where: { id: visit.id } });
    expect(stored.checkInAt?.toISOString()).toBe("2026-10-19T16:05:00.000Z");
    expect(stored.checkOutAt?.toISOString()).toBe("2026-10-19T20:00:00.000Z");
    const logs = await prisma.auditLog.findMany({
      where: { entityId: visit.id, action: "visit_hours_adjusted" },
      orderBy: { createdAt: "asc" },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0].actorUserId).toBe(admin.id);

    const report = await request(app)
      .get("/api/v1/admin/reports/visits?period=daily&date=2026-10-19")
      .set(auth(token));
    expect(report.body.data.summary.totalHours).toBe(7.25);
    expect(report.body.data.summary.averageHours).toBe(7.25);

    const blocked = await request(app)
      .post(`/api/v1/admin/reports/visits/${pendingVisit.id}/hours`)
      .set(auth(token))
      .send({ adjustedHours: 2, reason: "Not finished" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe("Hours can be corrected only after the day is marked complete");

    const missing = await request(app)
      .post("/api/v1/admin/reports/visits/00000000-0000-4000-8000-000000000099/hours")
      .set(auth(token))
      .send({ adjustedHours: 2, reason: "Missing visit" });
    expect(missing.status).toBe(404);

    const invalid = await request(app)
      .post(`/api/v1/admin/reports/visits/${visit.id}/hours`)
      .set(auth(token))
      .send({ adjustedHours: 24.001, reason: " " });
    expect(invalid.status).toBe(422);
    expect(invalid.body.errors.adjustedHours[0]).toMatch(/0 to 24|2 decimal/);
    expect(invalid.body.errors.reason[0]).toBe("reason is required");
  });

  it("filters by caregiver and resolves weekly, monthly, and custom ranges", async () => {
    const { token } = await adminToken();
    const { caregiver } = await seedDay();
    const other = await createUser({ email: "other@example.com", firstName: "Sam", lastName: "Lee" });

    const own = await request(app)
      .get(`/api/v1/admin/reports/visits?period=daily&date=2026-10-19&caregiverId=${caregiver.id}&status=all`)
      .set(auth(token));
    expect(own.status).toBe(200);
    expect(own.body.data.data.length).toBeGreaterThan(0);
    expect(own.body.data.data.every((row: { caregiver: { id: string } }) => row.caregiver.id === caregiver.id)).toBe(
      true,
    );

    const none = await request(app)
      .get(`/api/v1/admin/reports/visits?period=daily&date=2026-10-19&caregiverId=${other.id}&status=all`)
      .set(auth(token));
    expect(none.body.data.data).toEqual([]);
    expect(none.body.data.summary.scheduledDays).toBe(0);
    expect(none.body.data.summary.completionRate).toBeNull();

    const weekly = await request(app)
      .get("/api/v1/admin/reports/visits?period=weekly&date=2026-10-19&status=all")
      .set(auth(token));
    expect(new Date(`${weekly.body.data.from}T00:00:00.000Z`).getUTCDay()).toBe(1);
    expect(new Date(`${weekly.body.data.to}T00:00:00.000Z`).getUTCDay()).toBe(0);
    expect(weekly.body.data.from).toBe("2026-10-19");
    expect(weekly.body.data.to).toBe("2026-10-25");

    const monthly = await request(app)
      .get("/api/v1/admin/reports/visits?period=monthly&date=2026-10-19&status=all")
      .set(auth(token));
    expect(monthly.body.data.from).toBe("2026-10-01");
    expect(monthly.body.data.to).toBe("2026-10-31");

    const custom = await request(app)
      .get("/api/v1/admin/reports/visits?period=custom&from=2026-10-01&to=2027-10-02")
      .set(auth(token));
    expect(custom.status).toBe(422);
    expect(custom.body.errors.to[0]).toMatch(/366/);
  });

  it("exports the filtered report as a PDF and refuses caregivers", async () => {
    const { token } = await adminToken();
    await seedDay();
    const caregiver = await createUser({ email: "phone@example.com" });
    const session = await login(app, caregiver.email);

    const pdf = await request(app)
      .get("/api/v1/admin/reports/visits/export.pdf?period=daily&date=2026-10-19")
      .set(auth(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pdf.headers["content-disposition"]).toBe(
      'attachment; filename="visit-report-2026-10-19-to-2026-10-19.pdf"',
    );
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");

    const denied = await request(app)
      .get("/api/v1/admin/reports/visits?period=daily&date=2026-10-19")
      .set(auth(session.body.data.accessToken as string));
    expect(denied.status).toBe(403);

    const deniedPdf = await request(app)
      .get("/api/v1/admin/reports/visits/export.pdf?period=daily")
      .set(auth(session.body.data.accessToken as string));
    expect(deniedPdf.status).toBe(403);

    const deniedHours = await request(app)
      .post("/api/v1/admin/reports/visits/00000000-0000-4000-8000-000000000099/hours")
      .set(auth(session.body.data.accessToken as string))
      .send({ adjustedHours: 1, reason: "No" });
    expect(deniedHours.status).toBe(403);
  });
});
