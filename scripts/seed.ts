import { randomUUID } from "node:crypto";
import { adminNoteForOther, parseAppointmentType, parseGender, parseHazardType, parseProficiency, parseSeverity } from "../src/domain/enums";
import { calendarDateInTimeZone } from "../src/lib/timezone";
import { addDays } from "../src/lib/dates";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} before running the development seed.`);
  }
  return value;
}

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed when NODE_ENV is production.");
  }
  const email = required("SEED_CAREGIVER_EMAIL").toLowerCase();
  const password = required("SEED_CAREGIVER_PASSWORD");
  const firstName = required("SEED_CAREGIVER_FIRST_NAME");
  const lastName = required("SEED_CAREGIVER_LAST_NAME");
  const phone = process.env.SEED_CAREGIVER_PHONE?.trim() || "(604) 555-0148";
  if (password.length < 6) {
    throw new Error("SEED_CAREGIVER_PASSWORD must be at least 6 characters.");
  }

  const today = calendarDateInTimeZone(new Date(), "America/Vancouver");
  const passwordHash = await hashPassword(password);
  const caregiver = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      firstName,
      lastName,
      phone,
      role: "CAREGIVER",
      status: "active",
    },
    create: {
      id: randomUUID(),
      email,
      passwordHash,
      firstName,
      lastName,
      phone,
      role: "CAREGIVER",
      status: "active",
    },
  });

  const existing = await prisma.caregiverClientAssignment.count({ where: { caregiverId: caregiver.id } });
  if (existing > 0) {
    console.log(`Seed caregiver already has assignments. Password updated. id=${caregiver.id} email=${caregiver.email}`);
    console.log("The password was not printed. No client rows were deleted.");
    return;
  }

  const gender = parseGender("female");
  const clients = [];
  for (let index = 0; index < 11; index += 1) {
    const rich = index < 2;
    const client = await prisma.client.create({
      data: {
        id: randomUUID(),
        firstName: index === 0 ? "Margaret" : index === 1 ? "Harold" : `Client${String(index + 1).padStart(2, "0")}`,
        lastName: index === 0 ? "Chen" : index === 1 ? "Singh" : `Example${String(index + 1).padStart(2, "0")}`,
        dateOfBirth: date(index === 0 ? "1948-03-14" : "1944-02-02"),
        gender,
        phone: `(604) 555-${String(100 + index).padStart(4, "0")}`,
        email: index === 10 ? null : `client${index + 1}@example.com`,
        notes: rich ? "Prefers tea before medication." : "",
        status: "active",
        addressStreet: `${1200 + index} Maple Street`,
        addressApartment: rich ? "Apt 2" : "",
        addressCity: "Surrey",
        addressState: "BC",
        addressZipCode: "V3T 2W1",
        addressCountry: "Canada",
        gateAccessCode: rich ? "4821" : "",
        navigationInstructions: rich ? "Use the side entrance." : "",
      },
    });
    await prisma.caregiverClientAssignment.create({
      data: { id: randomUUID(), caregiverId: caregiver.id, clientId: client.id },
    });
    clients.push(client);
  }

  await prisma.client.create({
    data: {
      id: randomUUID(),
      firstName: "Inactive",
      lastName: "Record",
      gender: parseGender("male"),
      phone: "(604) 555-0199",
      notes: "",
      status: "inactive",
      addressStreet: "1 Quiet Road",
      addressCity: "Surrey",
      addressState: "BC",
      addressZipCode: "V3T 2W1",
      addressCountry: "Canada",
      assignments: { create: { id: randomUUID(), caregiverId: caregiver.id } },
    },
  });

  const primary = clients[0];
  await prisma.clientLanguage.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      name: "English",
      proficiency: parseProficiency("native"),
      isPrimary: true,
    },
  });
  await prisma.clientLanguage.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      name: "Cantonese",
      proficiency: parseProficiency("other"),
      proficiencyOtherNote: adminNoteForOther("other", "Conversational with family", "proficiency"),
      isPrimary: false,
      sortOrder: 1,
    },
  });
  await prisma.emergencyContact.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      name: "Lisa Chen",
      relationship: "Daughter",
      phone: "(604) 555-0102",
      isPrimary: true,
    },
  });
  await prisma.diagnosis.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      name: "Hypertension",
      icdCode: "I10",
      diagnosedDate: date("2018-04-12"),
      severity: parseSeverity("moderate"),
      notes: "Controlled with daily medication.",
    },
  });
  await prisma.diagnosis.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      name: "Penicillin allergy",
      icdCode: "Z88.0",
      diagnosedDate: date("1995-06-01"),
      severity: parseSeverity("other"),
      severityOtherNote: adminNoteForOther("other", "Recorded by the clinic", "severity"),
      notes: "Do not administer penicillin.",
    },
  });
  await prisma.clientHazard.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      type: parseHazardType("fall_risk"),
      description: "Unsteady on stairs.",
      severity: parseSeverity("moderate"),
      precautions: "Stay within arm's reach during transfers.",
    },
  });
  await prisma.serviceRequirement.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      service: "personal_care",
      startOn: date("2026-09-19"),
      endOn: date("2027-01-17"),
    },
  });

  const plan = await prisma.carePlan.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      name: "Daily Living Support",
      description: "Morning personal care and a light mobility routine.",
      status: "active",
      notes: "Review anything unusual with the family after the visit.",
      startDate: date("2026-09-28"),
      endDate: date("2026-12-18"),
      goals: {
        create: [
          { id: randomUUID(), text: "Keep the daily routine calm and predictable", sortOrder: 0 },
          { id: randomUUID(), text: "Support medication at the scheduled time", sortOrder: 1 },
        ],
      },
      tasks: {
        create: {
          id: randomUUID(),
          name: "Mobility walk",
          frequency: "Daily",
          description: "A short supervised walk.",
        },
      },
      medications: {
        create: {
          id: randomUUID(),
          medicationName: "Lisinopril",
          dosage: "10 mg",
          schedule: "With breakfast",
          description: "Give with water after food.",
        },
      },
      diet: {
        create: {
          id: randomUUID(),
          meal: "Breakfast",
          restrictions: "Low sodium",
          description: "Offer tea or water.",
        },
      },
      hygiene: {
        create: {
          id: randomUUID(),
          activity: "Morning wash",
          frequency: "Daily",
          description: "Assist with face, hands, and oral care.",
        },
      },
    },
  });

  const secondPlanClient = clients[1];
  await prisma.carePlan.create({
    data: {
      id: randomUUID(),
      clientId: secondPlanClient.id,
      name: "Evening check",
      description: "A short wellness visit.",
      status: "active",
      tasks: { create: { id: randomUUID(), name: "Conversation", frequency: "Daily", description: "" } },
      medications: { create: { id: randomUUID(), medicationName: "Vitamin D", dosage: "1000 IU", schedule: "Evening" } },
      diet: { create: { id: randomUUID(), meal: "Dinner", restrictions: "Soft foods" } },
      hygiene: { create: { id: randomUUID(), activity: "Oral care", frequency: "Daily" } },
    },
  });

  const appointmentType = parseAppointmentType("personal_care");
  await prisma.appointment.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      caregiverId: caregiver.id,
      carePlanId: plan.id,
      description: "Morning personal care and medication.",
      scheduledDate: date(today),
      endDate: date(addDays(today, 14)),
      startTime: "09:00",
      endTime: "10:30",
      durationMinutes: 90,
      appointmentType,
      appointmentStatus: "scheduled",
      recordStatus: "active",
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
  await prisma.appointment.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      caregiverId: caregiver.id,
      description: "Tomorrow wellness check.",
      scheduledDate: date(addDays(today, 1)),
      endDate: date(addDays(today, 1)),
      startTime: "11:00",
      endTime: "12:00",
      durationMinutes: 60,
      appointmentType: parseAppointmentType("wellness_check"),
      appointmentStatus: "scheduled",
      recordStatus: "active",
      locationStreet: "1284 Maple Street",
      locationCity: "Surrey",
      locationState: "BC",
      locationZipCode: "V3T 2W1",
      locationGateCode: "4821",
      locationNavigation: "Use the side entrance.",
    },
  });
  const yesterday = addDays(today, -1);
  const completed = await prisma.appointment.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      caregiverId: caregiver.id,
      description: "Yesterday's completed visit.",
      scheduledDate: date(yesterday),
      endDate: date(yesterday),
      startTime: "14:00",
      endTime: "15:00",
      durationMinutes: 60,
      appointmentType: parseAppointmentType("companionship"),
      appointmentStatus: "completed",
      recordStatus: "active",
      locationStreet: "1284 Maple Street",
      locationCity: "Surrey",
      locationState: "BC",
      locationZipCode: "V3T 2W1",
      locationNavigation: "",
    },
  });
  await prisma.appointmentDailyVisit.create({
    data: {
      id: randomUUID(),
      appointmentId: completed.id,
      serviceDate: date(yesterday),
      dailyVisitStatus: "completed",
      completed: true,
      active: false,
    },
  });
  await prisma.appointment.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      caregiverId: caregiver.id,
      description: "Cancelled visit.",
      scheduledDate: date(addDays(today, 2)),
      endDate: date(addDays(today, 2)),
      startTime: "15:00",
      endTime: "16:00",
      durationMinutes: 60,
      appointmentType: parseAppointmentType("other"),
      appointmentTypeOtherNote: adminNoteForOther("other", "One-off family request", "appointmentType"),
      appointmentStatus: "cancelled",
      cancellationReason: "Family requested a different day.",
      recordStatus: "active",
      locationStreet: "1284 Maple Street",
      locationCity: "Surrey",
      locationState: "BC",
      locationZipCode: "V3T 2W1",
      locationNavigation: "",
    },
  });
  await prisma.appointment.create({
    data: {
      id: randomUUID(),
      clientId: primary.id,
      caregiverId: caregiver.id,
      description: "Follow-up with the family physician.",
      scheduledDate: date(addDays(today, 5)),
      endDate: date(addDays(today, 5)),
      startTime: "13:30",
      endTime: "14:00",
      durationMinutes: 30,
      appointmentType: parseAppointmentType("doctor_visit"),
      appointmentStatus: "scheduled",
      recordStatus: "active",
      doctorName: "Dr. Priya Shah",
      doctorSpecialty: "Family medicine",
      doctorPhone: "(604) 555-2210",
      clinicName: "Example Family Clinic",
      locationStreet: "100 Clinic Way",
      locationCity: "Surrey",
      locationState: "BC",
      locationZipCode: "V3T 2W1",
      locationNavigation: "",
    },
  });

  console.log(`Seed caregiver ready. id=${caregiver.id} email=${caregiver.email}`);
  console.log(`Vancouver today used for the sample schedule: ${today}`);
  console.log("The password was not printed. Eleven active clients were inserted.");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Seed failed.";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
