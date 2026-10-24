import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = CAST(${userId} AS uuid) FOR UPDATE`;
}

export async function lockUserRefreshTokens(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM refresh_tokens WHERE user_id = CAST(${userId} AS uuid) FOR UPDATE`;
}

export async function lockRefreshFamily(tx: Tx, userId: string, familyId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM refresh_tokens
    WHERE user_id = CAST(${userId} AS uuid) AND family_id = CAST(${familyId} AS uuid)
    FOR UPDATE
  `;
}

export async function lockAppointment(tx: Tx, appointmentId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = CAST(${appointmentId} AS uuid) FOR UPDATE`;
}

export async function lockRelease(tx: Tx, releaseId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM appointment_releases WHERE id = CAST(${releaseId} AS uuid) FOR UPDATE`;
}

export async function lockCarePlan(tx: Tx, carePlanId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM care_plans WHERE id = CAST(${carePlanId} AS uuid) FOR UPDATE`;
}
