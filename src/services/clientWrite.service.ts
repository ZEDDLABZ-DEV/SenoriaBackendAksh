import { randomUUID } from "node:crypto";
import type { Diagnosis, Prisma } from "@prisma/client";
import { parseIsoDate } from "../lib/dates";
import { notFound, validation } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { pageMeta, type PageQuery } from "../validation/common";
import { assertUuid } from "../domain/ids";
import { getClient } from "./client.service";
import { closeOpenCoverageForAppointments } from "./coverage.service";
import { deliveringTransaction } from "./push.service";

const PRIMARY = "Primary condition";
const MEDICAL = "Medical condition";
const ALLERGY = "Allergy";

type Tx = Prisma.TransactionClient;

function blank(value: string | null | undefined): string {
  return value ?? "";
}

async function replaceTagged(tx: Tx, clientId: string, notes: string, names: string[]) {
  const existing = await tx.diagnosis.findMany({
    where: { clientId, notes },
    orderBy: { id: "asc" },
  });
  const used = new Set<string>();
  const cleaned = names.map((name) => name.trim()).filter((name) => name.length > 0);
  const rows = cleaned.map((name, index) => {
    let match = existing.find((row) => row.name === name && !used.has(row.id));
    if (!match && existing[index] && !used.has(existing[index].id)) {
      match = existing[index];
    }
    if (match) {
      used.add(match.id);
    }
    return carry(name, match);
  });
  await tx.diagnosis.deleteMany({ where: { clientId, notes } });
  for (const row of rows) {
    await tx.diagnosis.create({
      data: {
        id: randomUUID(),
        clientId,
        notes,
        isActive: true,
        name: row.name,
        icdCode: row.icdCode,
        diagnosedDate: row.diagnosedDate,
        severity: row.severity,
        severityOtherNote: row.severityOtherNote,
      },
    });
  }
}

function carry(name: string, match: Diagnosis | undefined) {
  return {
    name,
    icdCode: match?.icdCode ?? null,
    diagnosedDate: match?.diagnosedDate ?? null,
    severity: match?.severity ?? null,
    severityOtherNote: match?.severityOtherNote ?? null,
  };
}

export async function listClientsAdmin(query: PageQuery, today: string) {
  const where = query.search
    ? {
        OR: [
          { firstName: { contains: query.search, mode: "insensitive" as const } },
          { lastName: { contains: query.search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const total = await prisma.client.count({ where });
  const rows = await prisma.client.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    select: { id: true },
  });
  const data = [];
  for (const row of rows) {
    data.push(await getClient("", row.id, today, "any"));
  }
  return { data, meta: pageMeta(query.page, query.pageSize, total) };
}

export async function createClient(
  actorId: string,
  input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string;
    gender: "male" | "female" | "other";
    emergencyContactName: string;
    emergencyContactRelation: string;
    emergencyContactPhone: string;
    primaryCondition: string;
    medicalConditions: string[];
    allergies: string[];
    language: string;
    communicationNote: string;
    address: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
      apartment?: string;
      gateAccessCode?: string;
      navigationInstructions?: string;
    };
  },
  today: string,
) {
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.client.create({
      data: {
        id,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        dateOfBirth: parseIsoDate(input.dateOfBirth),
        gender: input.gender,
        phone: input.phone.trim(),
        email: null,
        notes: input.communicationNote,
        status: "active",
        addressStreet: blank(input.address.street),
        addressApartment: blank(input.address.apartment),
        addressCity: blank(input.address.city),
        addressState: blank(input.address.state),
        addressZipCode: blank(input.address.zipCode),
        addressCountry: blank(input.address.country),
        gateAccessCode: blank(input.address.gateAccessCode),
        navigationInstructions: blank(input.address.navigationInstructions),
        createdById: actorId,
        updatedById: actorId,
      },
    });
    const emergencyName = input.emergencyContactName.trim();
    const emergencyRelation = input.emergencyContactRelation.trim();
    const emergencyPhone = input.emergencyContactPhone.trim();
    if (emergencyName || emergencyRelation || emergencyPhone) {
      await tx.emergencyContact.create({
        data: {
          id: randomUUID(),
          clientId: id,
          name: emergencyName,
          relationship: emergencyRelation,
          phone: emergencyPhone,
          email: null,
          isPrimary: true,
          sortOrder: 0,
        },
      });
    }
    if (input.primaryCondition.trim()) {
      await replaceTagged(tx, id, PRIMARY, [input.primaryCondition]);
    }
    await replaceTagged(tx, id, MEDICAL, input.medicalConditions);
    await replaceTagged(tx, id, ALLERGY, input.allergies);
    if (input.language.trim()) {
      await tx.clientLanguage.create({
        data: {
          id: randomUUID(),
          clientId: id,
          name: input.language.trim(),
          proficiency: "fluent",
          isPrimary: true,
          sortOrder: 0,
        },
      });
    }
  });
  return getClient(actorId, id, today, "any");
}

export async function updateClient(
  actorId: string,
  clientId: string,
  present: Record<string, unknown>,
  value: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phone?: string;
    gender?: string;
    email?: string;
    status?: string;
    emergencyContactName?: string;
    emergencyContactRelation?: string;
    emergencyContactPhone?: string;
    primaryCondition?: string;
    medicalConditions?: string[];
    allergies?: string[];
    language?: string;
    communicationNote?: string;
    address?: Record<string, string | undefined>;
    diagnoses?: Array<{ id: string; icdCode: string | null }>;
  },
  today: string,
) {
  assertUuid(clientId);
  await prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw notFound();
    }
    const data: Prisma.ClientUpdateInput = { updatedBy: { connect: { id: actorId } } };
    if ("firstName" in present && value.firstName !== undefined) {
      data.firstName = value.firstName.trim();
    }
    if ("lastName" in present && value.lastName !== undefined) {
      data.lastName = value.lastName.trim();
    }
    if ("phone" in present && value.phone !== undefined) {
      data.phone = value.phone;
    }
    if ("gender" in present && value.gender !== undefined) {
      data.gender = value.gender;
    }
    if ("email" in present) {
      const email = value.email?.trim() ?? "";
      data.email = email.length > 0 ? email : null;
    }
    if ("status" in present && value.status !== undefined) {
      data.status = value.status;
    }
    if ("communicationNote" in present && value.communicationNote !== undefined) {
      data.notes = value.communicationNote;
    }
    if ("dateOfBirth" in present && value.dateOfBirth) {
      data.dateOfBirth = parseIsoDate(value.dateOfBirth);
    }
    if ("address" in present && value.address) {
      const address = value.address;
      if ("street" in address) data.addressStreet = blank(address.street);
      if ("apartment" in address) data.addressApartment = blank(address.apartment);
      if ("city" in address) data.addressCity = blank(address.city);
      if ("state" in address) data.addressState = blank(address.state);
      if ("zipCode" in address) data.addressZipCode = blank(address.zipCode);
      if ("country" in address) data.addressCountry = blank(address.country);
      if ("gateAccessCode" in address) data.gateAccessCode = blank(address.gateAccessCode);
      if ("navigationInstructions" in address) data.navigationInstructions = blank(address.navigationInstructions);
    }
    await tx.client.update({ where: { id: clientId }, data });

    if ("primaryCondition" in present) {
      await replaceTagged(tx, clientId, PRIMARY, [value.primaryCondition ?? ""]);
    }
    if ("medicalConditions" in present) {
      await replaceTagged(tx, clientId, MEDICAL, value.medicalConditions ?? []);
    }
    if ("allergies" in present) {
      await replaceTagged(tx, clientId, ALLERGY, value.allergies ?? []);
    }
    if ("language" in present && value.language?.trim()) {
      const primary = await tx.clientLanguage.findFirst({
        where: { clientId, isPrimary: true },
        orderBy: { sortOrder: "asc" },
      });
      if (primary) {
        await tx.clientLanguage.update({ where: { id: primary.id }, data: { name: value.language.trim() } });
      } else {
        await tx.clientLanguage.create({
          data: {
            id: randomUUID(),
            clientId,
            name: value.language.trim(),
            proficiency: "fluent",
            isPrimary: true,
            sortOrder: 0,
          },
        });
      }
    }
    if (
      "emergencyContactName" in present ||
      "emergencyContactRelation" in present ||
      "emergencyContactPhone" in present
    ) {
      const contact =
        (await tx.emergencyContact.findFirst({
          where: { clientId, isPrimary: true },
          orderBy: { sortOrder: "asc" },
        })) ??
        (await tx.emergencyContact.findFirst({ where: { clientId }, orderBy: { sortOrder: "asc" } }));
      const next = {
        name: "emergencyContactName" in present ? (value.emergencyContactName ?? "") : (contact?.name ?? ""),
        relationship:
          "emergencyContactRelation" in present
            ? (value.emergencyContactRelation ?? "")
            : (contact?.relationship ?? ""),
        phone: "emergencyContactPhone" in present ? (value.emergencyContactPhone ?? "") : (contact?.phone ?? ""),
      };
      if (contact) {
        await tx.emergencyContact.update({ where: { id: contact.id }, data: next });
      } else {
        await tx.emergencyContact.create({
          data: { id: randomUUID(), clientId, ...next, email: null, isPrimary: true, sortOrder: 0 },
        });
      }
    }
    if ("diagnoses" in present && value.diagnoses) {
      for (const diagnosis of value.diagnoses) {
        assertUuid(diagnosis.id);
        const row = await tx.diagnosis.findFirst({ where: { id: diagnosis.id, clientId } });
        if (!row) {
          throw validation("Diagnosis was not found on this client", {
            diagnoses: ["Diagnosis was not found on this client"],
          });
        }
        await tx.diagnosis.update({
          where: { id: row.id },
          data: { icdCode: diagnosis.icdCode },
        });
      }
    }
  });
  return getClient(actorId, clientId, today, "any");
}

export async function deleteClient(clientId: string): Promise<void> {
  assertUuid(clientId);
  await deliveringTransaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) {
      throw notFound();
    }
    const plans = await tx.carePlan.findMany({ where: { clientId }, select: { id: true } });
    const planIds = plans.map((plan) => plan.id);
    const appointments = await tx.appointment.findMany({ where: { clientId }, select: { id: true } });
    const appointmentIds = appointments.map((appointment) => appointment.id);
    if (planIds.length > 0 || appointmentIds.length > 0) {
      await tx.carePlanCheckIn.deleteMany({
        where: {
          OR: [
            ...(planIds.length > 0 ? [{ carePlanId: { in: planIds } }] : []),
            ...(appointmentIds.length > 0 ? [{ appointmentId: { in: appointmentIds } }] : []),
          ],
        },
      });
    }
    if (planIds.length > 0) {
      await tx.careItemCompletion.deleteMany({ where: { carePlanId: { in: planIds } } });
      await tx.carePlanGoal.deleteMany({ where: { carePlanId: { in: planIds } } });
      await tx.careTask.deleteMany({ where: { carePlanId: { in: planIds } } });
      await tx.careMedication.deleteMany({ where: { carePlanId: { in: planIds } } });
      await tx.careDietInstruction.deleteMany({ where: { carePlanId: { in: planIds } } });
      await tx.careHygieneInstruction.deleteMany({ where: { carePlanId: { in: planIds } } });
      await tx.carePlan.deleteMany({ where: { id: { in: planIds } } });
    }
    if (appointmentIds.length > 0) {
      await closeOpenCoverageForAppointments(tx, appointmentIds, "deleted");
      await tx.appointmentDailyVisit.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
      await tx.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    }
    await tx.visitSeriesExclusion.deleteMany({ where: { series: { clientId } } });
    await tx.visitSeries.deleteMany({ where: { clientId } });
    await tx.doctorAppointment.deleteMany({ where: { clientId } });
    await tx.serviceRequirement.deleteMany({ where: { clientId } });
    await tx.clientHazard.deleteMany({ where: { clientId } });
    await tx.diagnosis.deleteMany({ where: { clientId } });
    await tx.emergencyContact.deleteMany({ where: { clientId } });
    await tx.clientLanguage.deleteMany({ where: { clientId } });
    await tx.caregiverClientAssignment.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });
  });
}

export async function listHazards(clientId: string) {
  await requireExistingClient(clientId);
  const hazards = await prisma.clientHazard.findMany({
    where: { clientId },
    orderBy: { id: "asc" },
  });
  return hazards.map(serializeHazard);
}

export async function createHazard(clientId: string, input: { type: string; description: string }) {
  await requireExistingClient(clientId);
  const hazard = await prisma.clientHazard.create({
    data: {
      id: randomUUID(),
      clientId,
      type: input.type,
      description: input.description,
      severity: "low",
      precautions: "",
      isActive: true,
    },
  });
  return serializeHazard(hazard);
}

export async function updateHazard(
  clientId: string,
  hazardId: string,
  input: { type: string; description: string },
) {
  assertUuid(hazardId);
  const existing = await prisma.clientHazard.findFirst({ where: { id: hazardId, clientId } });
  if (!existing) {
    throw notFound();
  }
  const hazard = await prisma.clientHazard.update({
    where: { id: hazardId },
    data: { type: input.type, description: input.description },
  });
  return serializeHazard(hazard);
}

export async function deleteHazard(clientId: string, hazardId: string): Promise<void> {
  assertUuid(hazardId);
  const existing = await prisma.clientHazard.findFirst({ where: { id: hazardId, clientId } });
  if (!existing) {
    throw notFound();
  }
  await prisma.clientHazard.delete({ where: { id: hazardId } });
}

export async function createServiceRequirement(
  clientId: string,
  input: {
    category: string;
    name: string;
    description: string;
    frequency: string | null;
    specialInstructions: string;
    isActive: boolean;
  },
) {
  await requireExistingClient(clientId);
  return prisma.serviceRequirement.create({
    data: {
      id: randomUUID(),
      clientId,
      service: input.name,
      category: input.category,
      name: input.name,
      description: input.description,
      frequency: input.frequency,
      specialInstructions: input.specialInstructions,
      isActive: input.isActive,
    },
  }).then(serializeRequirement);
}

export async function updateServiceRequirement(
  clientId: string,
  requirementId: string,
  present: Record<string, unknown>,
  input: {
    category?: string;
    name?: string;
    description?: string;
    frequency?: string | null;
    specialInstructions?: string;
    isActive?: boolean;
  },
) {
  assertUuid(requirementId);
  const existing = await prisma.serviceRequirement.findFirst({ where: { id: requirementId, clientId } });
  if (!existing) {
    throw notFound();
  }
  const data: Prisma.ServiceRequirementUpdateInput = {};
  if ("category" in present && input.category !== undefined) data.category = input.category;
  if ("name" in present && input.name !== undefined) {
    data.name = input.name;
    data.service = input.name;
  }
  if ("description" in present) data.description = input.description ?? "";
  if ("frequency" in present) data.frequency = input.frequency;
  if ("specialInstructions" in present) data.specialInstructions = input.specialInstructions ?? "";
  if ("isActive" in present && input.isActive !== undefined) data.isActive = input.isActive;
  const updated = await prisma.serviceRequirement.update({ where: { id: requirementId }, data });
  return serializeRequirement(updated);
}

export async function deleteServiceRequirement(clientId: string, requirementId: string): Promise<void> {
  assertUuid(requirementId);
  const existing = await prisma.serviceRequirement.findFirst({ where: { id: requirementId, clientId } });
  if (!existing) {
    throw notFound();
  }
  await prisma.serviceRequirement.delete({ where: { id: requirementId } });
}

async function requireExistingClient(clientId: string): Promise<void> {
  assertUuid(clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) {
    throw notFound();
  }
}

function serializeHazard(hazard: {
  id: string;
  type: string;
  description: string;
  isActive: boolean;
  clientId: string;
}) {
  return {
    id: hazard.id,
    type: hazard.type,
    description: hazard.description,
    isActive: hazard.isActive,
    clientId: hazard.clientId,
  };
}

function serializeRequirement(requirement: {
  id: string;
  clientId: string;
  category: string | null;
  name: string | null;
  service: string;
  description: string | null;
  frequency: string | null;
  specialInstructions: string;
  isActive: boolean;
}) {
  return {
    id: requirement.id,
    category: requirement.category ?? requirement.service,
    name: requirement.name ?? requirement.service,
    description: requirement.description,
    frequency: requirement.frequency,
    specialInstructions: requirement.specialInstructions,
    isActive: requirement.isActive,
    clientId: requirement.clientId,
  };
}
