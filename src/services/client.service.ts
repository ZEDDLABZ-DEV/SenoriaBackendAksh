import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { serializeDoctorAppointment } from "../serializers/doctorAppointment";
import { serializeClientDetail, serializeClientListItem } from "../serializers/client";
import { completionMapForClients } from "./records";
import { requireClient, requireOwnedClient, requireSelf } from "./scope";
import type { ClientListQuery } from "../validation/clients";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function listClients(userId: string, caregiverId: string, query: ClientListQuery) {
  requireSelf(userId, caregiverId);
  const offset = (query.page - 1) * query.pageSize;
  const searchClause =
    query.search.length > 0
      ? Prisma.sql`AND (
          c.first_name ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'
          OR c.last_name ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'
          OR (c.first_name || ' ' || c.last_name) ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'
          OR c.phone ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'
          OR COALESCE(c.email, '') ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'
        )`
      : Prisma.empty;

  const whereSql = Prisma.sql`
    FROM clients c
    INNER JOIN caregiver_client_assignments a ON a.client_id = c.id
    WHERE a.caregiver_id = ${caregiverId}::uuid
      AND c.status = ${query.status}
      ${searchClause}
  `;

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS total ${whereSql}`),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT c.id
      ${whereSql}
      ORDER BY c.last_name ASC, c.first_name ASC, c.id ASC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `),
  ]);

  const total = Number(countRows[0]?.total ?? 0);
  const ids = idRows.map((row) => row.id);
  const clients = ids.length
    ? await prisma.client.findMany({ where: { id: { in: ids } } })
    : [];
  const byId = new Map(clients.map((client) => [client.id, client]));
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

  return {
    data: ids.flatMap((id) => {
      const client = byId.get(id);
      return client ? [serializeClientListItem(client)] : [];
    }),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1 && totalPages > 0,
    },
  };
}

export async function getClient(
  userId: string,
  clientId: string,
  today: string,
  scope: "assigned" | "any" = "assigned",
) {
  const client = scope === "any" ? await requireClient(clientId) : await requireOwnedClient(userId, clientId);
  const [completions, appointments, doctorAppointments] = await Promise.all([
    completionMapForClients([client.id], today),
    prisma.appointment.findMany({
      where: scope === "any" ? { clientId: client.id } : { clientId: client.id, caregiverId: userId },
      include: { caregiver: true },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    }),
    prisma.doctorAppointment.findMany({
      where: { clientId: client.id },
      include: {
        client: { select: { firstName: true, lastName: true } },
        type: { select: { name: true } },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    }),
  ]);
  return serializeClientDetail(
    client,
    completions,
    appointments,
    doctorAppointments.map(serializeDoctorAppointment),
  );
}
