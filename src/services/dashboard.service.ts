import { now } from "../lib/clock";
import { nullableDate, parseIsoDate } from "../lib/dates";
import { prisma } from "../lib/prisma";
import { validation } from "../lib/errors";
import { calendarDateForOffset } from "../lib/timezone";

export async function dashboardStats(offset: string | undefined) {
  let day: string;
  try {
    day = calendarDateForOffset(now(), offset ?? "");
  } catch {
    throw validation("timeZoneOffset must look like +05:30", {
      timeZoneOffset: ["timeZoneOffset must look like +05:30"],
    });
  }
  const dayDate = parseIsoDate(day);
  const [totalClients, activeCarePlans, totalCaregivers, appointments] = await Promise.all([
    prisma.client.count(),
    prisma.carePlan.count({ where: { status: "active" } }),
    prisma.user.count({ where: { role: "CAREGIVER", status: "active" } }),
    prisma.appointment.findMany({
      where: {
        appointmentStatus: { in: ["scheduled", "completed"] },
        scheduledDate: { lte: dayDate },
      },
      select: { scheduledDate: true, endDate: true, appointmentStatus: true },
    }),
  ]);
  const covering = appointments.filter((appointment) => {
    const start = nullableDate(appointment.scheduledDate);
    const end = nullableDate(appointment.endDate) ?? start;
    return Boolean(start && end && day >= start && day <= end);
  });
  const completedAppointmentsToday = covering.filter((row) => row.appointmentStatus === "completed").length;
  const pendingAppointmentsToday = covering.filter((row) => row.appointmentStatus === "scheduled").length;
  return {
    totalClients,
    activeCarePlans,
    todayAppointments: covering.length,
    totalCaregivers,
    completedAppointmentsToday,
    pendingAppointmentsToday,
    clientsGrowth: 0,
    appointmentsGrowth: 0,
  };
}
