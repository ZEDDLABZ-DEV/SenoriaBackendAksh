import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../src/app";
import { resetClock, setClock } from "../src/lib/clock";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";

export const PASSWORD = "example-password";
export const TODAY = "2026-10-19";
export const CLOCK = "2026-10-19T20:00:00.000Z";

const FORBIDDEN_KEYS = new Set([
  "_id",
  "password",
  "passwordHash",
  "tokenHash",
  "genderOtherNote",
  "proficiencyOtherNote",
  "severityOtherNote",
  "typeOtherNote",
  "appointmentTypeOtherNote",
  "gender_other_note",
  "proficiency_other_note",
  "severity_other_note",
  "type_other_note",
  "appointment_type_other_note",
]);

let passwordHashPromise: Promise<string> | undefined;
let app: Express | undefined;

export function testApp(): Express {
  app ??= createApp();
  return app;
}

export async function passwordHash(): Promise<string> {
  passwordHashPromise ??= hashPassword(PASSWORD);
  return passwordHashPromise;
}

export function useClock(iso = CLOCK): void {
  setClock({ now: () => new Date(iso) });
}

export async function resetDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(url) || /prod/i.test(url)) {
    throw new Error("Refusing to reset a database that is not an isolated test database.");
  }
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      visit_hour_adjustments,
      notifications,
      notification_devices,
      appointment_releases,
      audit_log,
      doctor_appointments,
      care_plan_check_ins,
      care_item_completions,
      appointment_daily_visits,
      appointment_services,
      appointments,
      visit_series_exclusions,
      visit_series,
      caregiver_availability,
      caregiver_time_off,
      care_hygiene_instructions,
      care_diet_instructions,
      care_medications,
      care_tasks,
      care_plan_goals,
      care_plans,
      service_requirements,
      client_hazards,
      diagnoses,
      emergency_contacts,
      client_languages,
      caregiver_client_assignments,
      clients,
      refresh_tokens,
      password_reset_tokens,
      user_permissions,
      users,
      doctor_appointment_types
    CASCADE
  `);
}

export async function createUser(input: {
  role?: "CAREGIVER" | "ADMIN";
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  phone?: string | null;
}) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: (input.email ?? `user-${randomUUID()}@example.com`).toLowerCase(),
      passwordHash: await passwordHash(),
      firstName: input.firstName ?? "Alex",
      lastName: input.lastName ?? "Rivera",
      role: input.role ?? "CAREGIVER",
      status: input.status ?? "active",
      phone: input.phone === undefined ? "(604) 555-0148" : input.phone,
    },
  });
}

export async function createClientFor(
  caregiverId: string,
  input: {
    firstName?: string;
    lastName?: string;
    status?: string;
    gender?: string;
    genderOtherNote?: string | null;
    email?: string | null;
    withClinical?: boolean;
  } = {},
) {
  const client = await prisma.client.create({
    data: {
      id: randomUUID(),
      firstName: input.firstName ?? "Margaret",
      lastName: input.lastName ?? "Chen",
      dateOfBirth: new Date("1948-03-14T00:00:00.000Z"),
      gender: input.gender ?? "female",
      genderOtherNote: input.genderOtherNote ?? null,
      phone: "(604) 555-0101",
      email: input.email === undefined ? "margaret.chen@example.com" : input.email,
      notes: "Prefers tea before medication.",
      status: input.status ?? "active",
      addressStreet: "1284 Maple Street",
      addressApartment: "Apt 2",
      addressCity: "Surrey",
      addressState: "BC",
      addressZipCode: "V3T 2W1",
      addressCountry: "Canada",
      gateAccessCode: "4821",
      navigationInstructions: "Use the side entrance.",
    },
  });
  await prisma.caregiverClientAssignment.create({
    data: { id: randomUUID(), caregiverId, clientId: client.id },
  });
  if (input.withClinical) {
    await prisma.clientLanguage.create({
      data: {
        id: randomUUID(),
        clientId: client.id,
        name: "English",
        proficiency: "other",
        proficiencyOtherNote: "Admin-only language note",
        isPrimary: true,
        sortOrder: 0,
      },
    });
    await prisma.emergencyContact.create({
      data: {
        id: randomUUID(),
        clientId: client.id,
        name: "Lisa Chen",
        relationship: "Daughter",
        phone: "(604) 555-0102",
        email: null,
        isPrimary: true,
        sortOrder: 0,
      },
    });
    await prisma.diagnosis.create({
      data: {
        id: randomUUID(),
        clientId: client.id,
        name: "Hypertension",
        icdCode: "I10",
        diagnosedDate: new Date("2018-04-12T00:00:00.000Z"),
        severity: "other",
        severityOtherNote: "Admin-only diagnosis note",
        notes: "Controlled with daily medication.",
        isActive: true,
      },
    });
    await prisma.clientHazard.create({
      data: {
        id: randomUUID(),
        clientId: client.id,
        type: "other",
        typeOtherNote: "Admin-only hazard note",
        description: "Unsteady on stairs.",
        severity: "moderate",
        severityOtherNote: null,
        precautions: "Stay within arm's reach.",
        isActive: true,
      },
    });
    await prisma.serviceRequirement.create({
      data: {
        id: randomUUID(),
        clientId: client.id,
        service: "personal_care",
        startOn: new Date("2026-09-19T00:00:00.000Z"),
        endOn: new Date("2027-01-17T00:00:00.000Z"),
      },
    });
  }
  return client;
}

export async function createPlan(
  clientId: string,
  input: { withItems?: boolean } = {},
) {
  const plan = await prisma.carePlan.create({
    data: {
      id: randomUUID(),
      clientId,
      name: "Daily Living Support",
      description: "Morning personal care.",
      status: "active",
      notes: "",
      startDate: new Date("2026-09-28T00:00:00.000Z"),
      endDate: new Date("2026-12-18T00:00:00.000Z"),
    },
  });
  await prisma.carePlanGoal.create({
    data: { id: randomUUID(), carePlanId: plan.id, text: "Support medication at the scheduled time", sortOrder: 0 },
  });
  if (input.withItems !== false) {
    await prisma.careTask.create({
      data: {
        id: randomUUID(),
        carePlanId: plan.id,
        name: "Mobility walk",
        frequency: "Daily",
        description: "A short supervised walk.",
        sortOrder: 0,
      },
    });
    await prisma.careMedication.create({
      data: {
        id: randomUUID(),
        carePlanId: plan.id,
        medicationName: "Lisinopril",
        dosage: "10 mg",
        schedule: "With breakfast",
        description: "Give with water after food.",
        sortOrder: 0,
      },
    });
    await prisma.careDietInstruction.create({
      data: {
        id: randomUUID(),
        carePlanId: plan.id,
        meal: "Breakfast",
        restrictions: "Low sodium",
        description: "Offer tea or water.",
        sortOrder: 0,
      },
    });
    await prisma.careHygieneInstruction.create({
      data: {
        id: randomUUID(),
        carePlanId: plan.id,
        activity: "Morning wash",
        frequency: "Daily",
        description: "Assist with face, hands, and oral care.",
        sortOrder: 0,
      },
    });
  }
  return prisma.carePlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { tasks: true, medications: true, diet: true, hygiene: true },
  });
}

export async function createAppointment(input: {
  clientId: string;
  caregiverId: string;
  carePlanId?: string | null;
  scheduledDate: string;
  endDate?: string | null;
  appointmentStatus?: string;
  recordStatus?: string;
  appointmentType?: string;
  appointmentTypeOtherNote?: string | null;
  description?: string;
}) {
  return prisma.appointment.create({
    data: {
      id: randomUUID(),
      clientId: input.clientId,
      caregiverId: input.caregiverId,
      carePlanId: input.carePlanId ?? null,
      description: input.description ?? "Morning personal care and medication.",
      scheduledDate: new Date(`${input.scheduledDate}T00:00:00.000Z`),
      endDate: new Date(`${input.endDate ?? input.scheduledDate}T00:00:00.000Z`),
      startTime: "09:00",
      endTime: "10:30",
      durationMinutes: 90,
      appointmentType: input.appointmentType ?? "personal_care",
      appointmentTypeOtherNote: input.appointmentTypeOtherNote ?? null,
      appointmentStatus: input.appointmentStatus ?? "scheduled",
      recordStatus: input.recordStatus ?? "active",
      instructions: "Confirm breakfast before the morning tablets.",
      notes: "Family may call during the visit.",
      locationStreet: "1284 Maple Street",
      locationCity: "Surrey",
      locationState: "BC",
      locationZipCode: "V3T 2W1",
      locationGateCode: "4821",
      locationNavigation: "Use the side entrance. Ring the bell twice.",
    },
  });
}

export async function login(appInstance: Express, email: string, password = PASSWORD) {
  return request(appInstance)
    .post("/api/v1/auth/login")
    .set("Accept", "application/json")
    .set("Content-Type", "application/json")
    .send({ email, password, role: "CAREGIVER" });
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

export function checkInBody(date = TODAY, appointmentId?: string) {
  return {
    timestamp: "2026-10-19T16:05:00.000Z",
    location: { latitude: 49.1913, longitude: -122.849 },
    date,
    ...(appointmentId ? { appointmentId } : {}),
  };
}

export function assertNoForbiddenKeys(value: unknown): void {
  const keys = new Set<string>();
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry && typeof entry === "object") {
      for (const [key, child] of Object.entries(entry)) {
        keys.add(key);
        visit(child);
      }
    }
  };
  visit(value);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Response exposed ${key}`);
    }
  }
}

export function assertStringIds(value: unknown): void {
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry && typeof entry === "object") {
      for (const [key, child] of Object.entries(entry)) {
        if (key === "id" || key.endsWith("Id")) {
          if (typeof child !== "string" && child !== null) {
            throw new Error(`${key} must be a string`);
          }
        }
        visit(child);
      }
    }
  };
  visit(value);
}

export async function prepare(): Promise<void> {
  useClock();
  await resetDatabase();
}

export function restoreClock(): void {
  resetClock();
}
