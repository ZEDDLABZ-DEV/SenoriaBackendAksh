import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { PASSWORD, auth, createClientFor, createUser, prepare, restoreClock, testApp } from "./helpers";

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
  return response.body.data.accessToken as string;
}

function doctorBody(clientId: string, typeId: string) {
  return {
    clientId,
    typeId,
    doctorName: "Dr. Priya Shah",
    specialty: "Family medicine",
    phone: "(604) 555-2210",
    clinicName: "Senoria Family Clinic",
    scheduledDate: "2026-10-26",
    startTime: "13:30",
    endTime: "14:00",
    description: "Follow-up with the family physician",
  };
}

describe("doctor appointments", () => {
  it("schedules a doctor's appointment and shows it to the assigned caregiver", async () => {
    const token = await adminToken();
    const caregiver = await createUser({ email: "care@example.com" });
    const other = await createUser({ email: "other@example.com" });
    const client = await createClientFor(caregiver.id, { firstName: "Margaret", lastName: "Chen" });
    const caregiverLogin = await request(app).post("/api/v1/auth/login").send({
      email: caregiver.email,
      password: PASSWORD,
    });
    const otherLogin = await request(app).post("/api/v1/auth/login").send({
      email: other.email,
      password: PASSWORD,
    });
    const caregiverToken = caregiverLogin.body.data.accessToken as string;
    const otherToken = otherLogin.body.data.accessToken as string;

    const type = await request(app)
      .post("/api/v1/doctor-appointment-types")
      .set(auth(token))
      .send({ name: "Doctor's Appointment" });
    expect(type.status).toBe(200);
    expect(type.body.data).toMatchObject({ name: "Doctor's Appointment" });

    const duplicate = await request(app)
      .post("/api/v1/doctor-appointment-types")
      .set(auth(token))
      .send({ name: "doctor's appointment" });
    expect(duplicate.status).toBe(422);

    const created = await request(app)
      .post("/api/v1/doctor-appointments")
      .set(auth(token))
      .send(doctorBody(client.id, type.body.data.id));
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({
      clientId: client.id,
      clientName: "Margaret Chen",
      typeId: type.body.data.id,
      typeName: "Doctor's Appointment",
      status: "scheduled",
      doctorName: "Dr. Priya Shah",
      specialty: "Family medicine",
      phone: "(604) 555-2210",
      clinicName: "Senoria Family Clinic",
      scheduledDate: "2026-10-26",
      startTime: "13:30",
      endTime: "14:00",
      description: "Follow-up with the family physician",
    });

    const portal = await request(app).get("/api/v1/doctor-appointments?search=Priya").set(auth(token));
    expect(portal.status).toBe(200);
    expect(portal.body.data.data).toHaveLength(1);

    const appList = await request(app)
      .get(`/api/v1/doctor-appointments/client/${client.id}`)
      .set(auth(caregiverToken));
    expect(appList.status).toBe(200);
    expect(appList.body.data).toHaveLength(1);
    expect(appList.body.data[0].doctorName).toBe("Dr. Priya Shah");

    const detail = await request(app).get(`/api/v1/clients/${client.id}`).set(auth(caregiverToken));
    expect(detail.body.data.doctorAppointments).toHaveLength(1);
    expect(detail.body.data.doctorAppointments[0].clinicName).toBe("Senoria Family Clinic");

    const hidden = await request(app)
      .get(`/api/v1/doctor-appointments/${created.body.data.id}`)
      .set(auth(otherToken));
    expect(hidden.status).toBe(404);

    const updated = await request(app)
      .put(`/api/v1/doctor-appointments/${created.body.data.id}`)
      .set(auth(token))
      .send({ status: "completed", specialty: "Geriatrics" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe("completed");
    expect(updated.body.data.specialty).toBe("Geriatrics");
    expect(updated.body.data.doctorName).toBe("Dr. Priya Shah");

    const blocked = await request(app)
      .delete(`/api/v1/doctor-appointment-types/${type.body.data.id}`)
      .set(auth(token));
    expect(blocked.status).toBe(422);

    const removed = await request(app)
      .delete(`/api/v1/doctor-appointments/${created.body.data.id}`)
      .set(auth(token));
    expect(removed.status).toBe(200);
    const typeRemoved = await request(app)
      .delete(`/api/v1/doctor-appointment-types/${type.body.data.id}`)
      .set(auth(token));
    expect(typeRemoved.status).toBe(200);
  });

  it("rejects a visit whose end time is not after the start time", async () => {
    const token = await adminToken();
    const caregiver = await createUser({});
    const client = await createClientFor(caregiver.id);
    const type = await request(app)
      .post("/api/v1/doctor-appointment-types")
      .set(auth(token))
      .send({ name: "Follow-up" });
    const response = await request(app)
      .post("/api/v1/doctor-appointments")
      .set(auth(token))
      .send({ ...doctorBody(client.id, type.body.data.id), endTime: "13:30" });
    expect(response.status).toBe(422);
    expect(response.body.errors.endTime).toBeDefined();
  });
});

describe("caregiver types", () => {
  it("adds, renames, and removes a caregiver type used by the caregiver dropdown", async () => {
    const token = await adminToken();
    const created = await request(app)
      .post("/api/v1/caregiver-positions")
      .set(auth(token))
      .send({ name: "Overnight Support" });
    expect(created.status).toBe(200);

    const account = await request(app).post("/api/v1/users/caregivers").set(auth(token)).send({
      firstName: "Nina",
      lastName: "Cole",
      email: "nina@example.com",
      password: PASSWORD,
      position: "Overnight Support",
      phone: "(604) 555-0188",
    });
    expect(account.status).toBe(200);
    expect(account.body.data.role).toBe("Overnight Support");

    const renamed = await request(app)
      .put(`/api/v1/caregiver-positions/${created.body.data.id}`)
      .set(auth(token))
      .send({ name: "Night Support" });
    expect(renamed.status).toBe(200);
    const stored = await prisma.user.findUnique({ where: { email: "nina@example.com" } });
    expect(stored?.position).toBe("Night Support");

    const blocked = await request(app)
      .delete(`/api/v1/caregiver-positions/${created.body.data.id}`)
      .set(auth(token));
    expect(blocked.status).toBe(422);

    await prisma.user.update({ where: { email: "nina@example.com" }, data: { position: "Other" } });
    const removed = await request(app)
      .delete(`/api/v1/caregiver-positions/${created.body.data.id}`)
      .set(auth(token));
    expect(removed.status).toBe(200);

    const list = await request(app).get("/api/v1/caregiver-positions").set(auth(token));
    expect(list.body.data.some((row: { name: string }) => row.name === "Night Support")).toBe(false);
    expect(list.body.data.some((row: { name: string }) => row.name === "Registered Nurse (RN)")).toBe(true);
  });
});
