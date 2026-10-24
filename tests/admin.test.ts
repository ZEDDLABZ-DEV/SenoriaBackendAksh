import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  PASSWORD,
  auth,
  createAppointment,
  createClientFor,
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

function clientBody() {
  return {
    firstName: "Margaret",
    lastName: "Chen",
    dateOfBirth: "1948-03-14",
    phone: "(604) 555-0101",
    gender: "female",
    emergencyContactName: "Lisa Chen",
    emergencyContactRelation: "Daughter",
    emergencyContactPhone: "(604) 555-0199",
    primaryCondition: "Hypertension",
    medicalConditions: ["Diabetes"],
    allergies: ["Penicillin"],
    language: "English",
    communicationNote: "Prefers tea.",
    address: {
      street: "1284 Maple Street",
      city: "Surrey",
      state: "BC",
      zipCode: "V3T 2W1",
      country: "Canada",
      apartment: "Apt 2",
      gateAccessCode: "4821",
      navigationInstructions: "Use the side entrance.",
    },
  };
}

function visitBody(clientId: string, caregiverId: string, startTime: string, endTime: string) {
  return {
    description: "Morning visit",
    clientId,
    caregiverId,
    scheduledDate: "2026-10-20",
    startTime,
    endTime,
    appointmentType: "regular_visit",
    instructions: "Ring twice",
    notes: "Bring the blue folder.",
    locationStreet: "1284 Maple Street",
    locationCity: "Surrey",
    locationState: "BC",
    locationZipCode: "V3T 2W1",
    locationGateCode: "4821",
    locationNavigation: "Use the side entrance.",
  };
}

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
  return { admin, token: response.body.data.accessToken as string, response };
}

describe("admin API", () => {
  it("logs in an ADMIN account with the shared envelope and no role claim", async () => {
    const { admin, token, response } = await adminToken();
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Signed in");
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.expiresIn).toBe(3600);
    expect(response.body.data.user).toMatchObject({
      id: admin.id,
      role: "ADMIN",
      permissions: [],
    });
    const payload = jwt.decode(token) as jwt.JwtPayload;
    expect(payload.sub).toBe(admin.id);
    expect(payload.role).toBeUndefined();
  });

  it("rejects a caregiver token on admin lists", async () => {
    const caregiver = await createUser({ email: "caregiver@example.com" });
    const session = await login(app, caregiver.email);
    const token = session.body.data.accessToken as string;

    const clients = await request(app).get("/api/v1/clients").set(auth(token));
    expect(clients.status).toBe(403);
    expect(clients.body.message).toBe("You do not have permission to do that.");
    expect(clients.body.message).toBe(clients.body.error.message);
    expect(clients.body.code).toBe("FORBIDDEN");
    expect(clients.body.error.code).toBe("FORBIDDEN");
    expect(clients.body.errors).toEqual({});
    expect(clients.body.error.fields).toEqual({});

    const caregivers = await request(app).get("/api/v1/users/caregivers").set(auth(token));
    expect(caregivers.status).toBe(403);
    expect(caregivers.body.code).toBe("FORBIDDEN");

    const removed = await request(app)
      .delete("/api/v1/appointments/00000000-0000-4000-8000-000000000099")
      .set(auth(token));
    expect(removed.status).toBe(403);
    expect(removed.body.error.message).toBe(removed.body.message);
  });

  it("creates a client and returns the same nested profile", async () => {
    const { token } = await adminToken();
    const created = await request(app).post("/api/v1/clients").set(auth(token)).send(clientBody());
    expect(created.status).toBe(200);
    const id = created.body.data.id as string;
    expect(id).toEqual(expect.any(String));

    const detail = await request(app).get(`/api/v1/clients/${id}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      id,
      firstName: "Margaret",
      lastName: "Chen",
      status: "active",
      email: null,
      phone: "(604) 555-0101",
      address: { street: "1284 Maple Street", city: "Surrey" },
      emergencyContacts: [
        {
          name: "Lisa Chen",
          relationship: "Daughter",
          phone: "(604) 555-0199",
        },
      ],
    });
    expect(detail.body.data.emergencyContacts).toHaveLength(1);
    expect(detail.body.data.carePlans).toEqual([]);

    const minimal = await request(app).post("/api/v1/clients").set(auth(token)).send({
      firstName: "Helen",
      lastName: "",
      dateOfBirth: "1939-01-02",
      gender: "female",
      primaryCondition: "",
      medicalConditions: [],
      allergies: [],
      language: "",
      communicationNote: "",
      address: {},
    });
    expect(minimal.status).toBe(200);
    expect(minimal.body.data.phone).toBe("");
    expect(minimal.body.data.emergencyContacts).toEqual([]);
    const notes = detail.body.data.diagnoses.map((diagnosis: { name: string; notes: string }) => [
      diagnosis.name,
      diagnosis.notes,
    ]);
    expect(notes).toEqual(
      expect.arrayContaining([
        ["Hypertension", "Primary condition"],
        ["Diabetes", "Medical condition"],
        ["Penicillin", "Allergy"],
      ]),
    );
  });

  it("keeps email when a profile update omits it", async () => {
    const { token } = await adminToken();
    const created = await request(app).post("/api/v1/clients").set(auth(token)).send(clientBody());
    const id = created.body.data.id as string;

    const withEmail = await request(app).put(`/api/v1/clients/${id}`).set(auth(token)).send({
      email: "margaret.kept@example.com",
      phone: "(604) 555-0101",
    });
    expect(withEmail.status).toBe(200);
    expect(withEmail.body.data.email).toBe("margaret.kept@example.com");

    const profile = clientBody();
    const merged = await request(app)
      .put(`/api/v1/clients/${id}`)
      .set(auth(token))
      .send({
        firstName: profile.firstName,
        lastName: profile.lastName,
        dateOfBirth: profile.dateOfBirth,
        phone: profile.phone,
        gender: profile.gender,
        emergencyContactName: profile.emergencyContactName,
        emergencyContactRelation: profile.emergencyContactRelation,
        emergencyContactPhone: profile.emergencyContactPhone,
        primaryCondition: profile.primaryCondition,
        medicalConditions: profile.medicalConditions,
        allergies: profile.allergies,
        language: profile.language,
        communicationNote: profile.communicationNote,
        address: profile.address,
      });
    expect(merged.status).toBe(200);
    expect(merged.body.data.email).toBe("margaret.kept@example.com");

    const detail = await request(app).get(`/api/v1/clients/${id}`).set(auth(token));
    expect(detail.body.data.email).toBe("margaret.kept@example.com");
    expect(detail.body.data.emergencyContacts).toHaveLength(1);
  });

  it("creates an appointment and rejects an overlapping visit", async () => {
    const { token } = await adminToken();
    const caregiver = await createUser({ email: "alex.rivera@example.com" });
    const client = await createClientFor(caregiver.id);

    const created = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "09:00", "10:00"));
    expect(created.status).toBe(200);
    expect(created.body.data.id).toEqual(expect.any(String));

    const detail = await request(app).get(`/api/v1/appointments/${created.body.data.id}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.appointmentStatus).toBe("scheduled");
    expect(detail.body.data.notes).toBe("Bring the blue folder.");
    expect(detail.body.data.clientId).toBe(client.id);

    const overlap = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "09:30", "11:00"));
    expect(overlap.status).toBe(422);
    expect(overlap.body.code).toBe("VALIDATION_ERROR");
    expect(overlap.body.message).toBe(overlap.body.error.message);
    expect(overlap.body.errors.startTime[0]).toBe(overlap.body.error.fields.startTime);
    expect(overlap.body.message).toContain("already has a visit");
  });

  it("shows a client to the caregiver after a visit is scheduled", async () => {
    const { token } = await adminToken();
    const assigned = await createUser({ email: "blair@example.com", firstName: "Blair", lastName: "Nguyen" });
    const caregiver = await createUser({ email: "alex.rivera@example.com" });
    const client = await createClientFor(assigned.id, { firstName: "Mike", lastName: "Hussey" });

    const created = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send(visitBody(client.id, caregiver.id, "09:00", "10:00"));
    expect(created.status).toBe(200);

    const session = await login(app, caregiver.email);
    const list = await request(app)
      .get(`/api/v1/clients/caregiver/${caregiver.id}`)
      .query({ page: "1", pageSize: "10", status: "active" })
      .set(auth(session.body.data.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.data.map((row: { id: string }) => row.id)).toEqual([client.id]);

    const moved = await createUser({ email: "casey@example.com", firstName: "Casey", lastName: "Ng" });
    const updated = await request(app)
      .put(`/api/v1/appointments/${created.body.data.id}`)
      .set(auth(token))
      .send({ caregiverId: moved.id });
    expect(updated.status).toBe(200);

    const movedSession = await login(app, moved.email);
    const movedList = await request(app)
      .get(`/api/v1/clients/caregiver/${moved.id}`)
      .query({ page: "1", pageSize: "10", status: "active" })
      .set(auth(movedSession.body.data.accessToken));
    expect(movedList.body.data.data.map((row: { id: string }) => row.id)).toEqual([client.id]);
  });

  it("lets a caregiver cancel without clearing notes", async () => {
    const caregiver = await createUser({ email: "alex.rivera@example.com" });
    const client = await createClientFor(caregiver.id);
    const appointment = await createAppointment({
      clientId: client.id,
      caregiverId: caregiver.id,
      scheduledDate: "2026-10-20",
      endDate: "2026-10-20",
    });
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { notes: "Bring the blue folder." },
    });
    const session = await login(app, caregiver.email);

    const cancelled = await request(app)
      .put(`/api/v1/appointments/${appointment.id}`)
      .set(auth(session.body.data.accessToken))
      .send({ appointmentStatus: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      appointmentStatus: "cancelled",
      notes: "Bring the blue folder.",
      clientId: client.id,
      caregiverId: caregiver.id,
      locationStreet: "1284 Maple Street",
      startTime: "09:00",
      endTime: "10:30",
      scheduledDate: "2026-10-20",
    });

    const stored = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(stored?.notes).toBe("Bring the blue folder.");
    expect(stored?.clientId).toBe(client.id);
    expect(stored?.caregiverId).toBe(caregiver.id);
    expect(stored?.scheduledDate?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(stored?.locationStreet).toBe("1284 Maple Street");
  });

  it("stores several visit services chosen from the settings list", async () => {
    const { token } = await adminToken();
    const catalog = await request(app).get("/api/v1/services").set(auth(token));
    expect(catalog.status).toBe(200);
    const names = catalog.body.data.map((row: { name: string }) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Bathing",
        "Cooking",
        "Companionship",
        "Light housekeeping",
        "Medication reminder",
        "Wound care",
        "Respite care",
        "Dementia support",
        "Fall prevention",
        "Transportation",
        "Appointment",
      ]),
    );

    const bathing = catalog.body.data.find((row: { name: string }) => row.name === "Bathing");
    const cooking = catalog.body.data.find((row: { name: string }) => row.name === "Cooking");
    const caregiver = await createUser({ email: "services.caregiver@example.com" });
    const client = await createClientFor(caregiver.id);
    const created = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send({
        ...visitBody(client.id, caregiver.id, "13:00", "14:00"),
        serviceIds: [cooking.id, bathing.id, bathing.id],
      });
    expect(created.status).toBe(200);

    const detail = await request(app).get(`/api/v1/appointments/${created.body.data.id}`).set(auth(token));
    expect(detail.body.data.services.map((row: { name: string }) => row.name)).toEqual(["Bathing", "Cooking"]);

    const replaced = await request(app)
      .put(`/api/v1/appointments/${created.body.data.id}`)
      .set(auth(token))
      .send({ serviceIds: [cooking.id] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.services).toEqual([{ id: cooking.id, name: "Cooking" }]);

    const blocked = await request(app).delete(`/api/v1/services/${cooking.id}`).set(auth(token));
    expect(blocked.status).toBe(422);

    const added = await request(app).post("/api/v1/services").set(auth(token)).send({ name: "Pet care" });
    expect(added.status).toBe(200);
    const duplicate = await request(app).post("/api/v1/services").set(auth(token)).send({ name: "pet care" });
    expect(duplicate.status).toBe(422);
    const renamed = await request(app)
      .put(`/api/v1/services/${added.body.data.id}`)
      .set(auth(token))
      .send({ name: "Pet support" });
    expect(renamed.status).toBe(200);
    const removed = await request(app).delete(`/api/v1/services/${added.body.data.id}`).set(auth(token));
    expect(removed.status).toBe(200);

    const unknown = await request(app)
      .post("/api/v1/appointments")
      .set(auth(token))
      .send({
        ...visitBody(client.id, caregiver.id, "15:00", "16:00"),
        serviceIds: ["00000000-0000-4000-8000-000000000099"],
      });
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors.serviceIds).toEqual(expect.any(Array));
  });

  it("lets an admin replace a caregiver password and rejects everyone else", async () => {
    const { admin, token } = await adminToken();
    const caregiver = await createUser({ email: "reset.care@example.com" });
    const session = await login(app, caregiver.email);

    const changed = await request(app)
      .post(`/api/v1/users/caregivers/${caregiver.id}/password`)
      .set(auth(token))
      .send({ password: "new-password" });
    expect(changed.status).toBe(200);
    expect(changed.body.data.email).toBe(caregiver.email);
    expect(JSON.stringify(changed.body)).not.toContain("passwordHash");

    const oldSession = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: session.body.data.refreshToken,
    });
    expect(oldSession.status).toBe(401);

    const oldPassword = await login(app, caregiver.email, PASSWORD);
    expect(oldPassword.status).toBe(401);
    const nextPassword = await login(app, caregiver.email, "new-password");
    expect(nextPassword.status).toBe(200);

    const caregiverAttempt = await request(app)
      .post(`/api/v1/users/caregivers/${caregiver.id}/password`)
      .set(auth(nextPassword.body.data.accessToken))
      .send({ password: "another-password" });
    expect(caregiverAttempt.status).toBe(403);

    const adminTarget = await request(app)
      .post(`/api/v1/users/caregivers/${admin.id}/password`)
      .set(auth(token))
      .send({ password: "another-password" });
    expect(adminTarget.status).toBe(404);

    const shortPassword = await request(app)
      .post(`/api/v1/users/caregivers/${caregiver.id}/password`)
      .set(auth(token))
      .send({ password: "short" });
    expect(shortPassword.status).toBe(422);
  });
});
