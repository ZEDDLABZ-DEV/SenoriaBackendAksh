import { randomUUID } from "node:crypto";
import { now } from "../lib/clock";
import { addDays, eachDate, formatClock, formatDate, nullableDate, parseIsoDate } from "../lib/dates";
import { logError } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { calendarDateInTimeZone, DEFAULT_TIME_ZONE, zonedDateTimeToUtc } from "../lib/timezone";
import { deliveringTransaction, queueNotificationPushes } from "./push.service";

export const APPOINTMENT_REMINDER_TYPES = {
  checkIn15m: "appointment_checkin_15m_before",
  checkInStart: "appointment_checkin_at_start",
  checkOut15m: "appointment_checkout_15m_before",
  checkOutEnd: "appointment_checkout_at_end",
} as const;

export type AppointmentReminderType =
  (typeof APPOINTMENT_REMINDER_TYPES)[keyof typeof APPOINTMENT_REMINDER_TYPES];

const FIFTEEN_MINUTES_MS = 15 * 60_000;
/** Catch-up window so a missed poll still delivers once; dedupe prevents doubles. */
const DUE_WINDOW_MS = 5 * 60_000;
const SERVICE_DATE_IN_BODY = /\b(\d{4}-\d{2}-\d{2})\b/;
const TERMINAL_DAILY = new Set(["completed", "cancelled", "missed"]);

interface ReminderSpec {
  type: AppointmentReminderType;
  title: string;
  body: string;
  target: Date;
  forCheckIn: boolean;
}

function clientName(client: { firstName: string; lastName: string }): string {
  return `${client.firstName} ${client.lastName}`.trim();
}

function isDue(target: Date, current: Date): boolean {
  const delta = current.getTime() - target.getTime();
  return delta >= 0 && delta < DUE_WINDOW_MS;
}

function alreadySentKey(appointmentId: string, type: string, serviceDate: string): string {
  return `${appointmentId}|${type}|${serviceDate}`;
}

function remindersForVisit(
  serviceDate: string,
  startTime: string,
  endTime: string,
  who: string,
  timeZone: string,
): ReminderSpec[] {
  const start = zonedDateTimeToUtc(serviceDate, formatClock(startTime), timeZone);
  const end = zonedDateTimeToUtc(serviceDate, formatClock(endTime), timeZone);
  return [
    {
      type: APPOINTMENT_REMINDER_TYPES.checkIn15m,
      title: "Visit starting soon",
      body: `Your visit with ${who} on ${serviceDate} starts in 15 minutes. Please check in and begin care plan tasks.`,
      target: new Date(start.getTime() - FIFTEEN_MINUTES_MS),
      forCheckIn: true,
    },
    {
      type: APPOINTMENT_REMINDER_TYPES.checkInStart,
      title: "Visit starting now",
      body: `Your visit with ${who} on ${serviceDate} is starting now. Please check in and begin care plan tasks.`,
      target: start,
      forCheckIn: true,
    },
    {
      type: APPOINTMENT_REMINDER_TYPES.checkOut15m,
      title: "Visit ending soon",
      body: `Your visit with ${who} on ${serviceDate} ends in 15 minutes. Please finish remaining tasks and prepare to check out.`,
      target: new Date(end.getTime() - FIFTEEN_MINUTES_MS),
      forCheckIn: false,
    },
    {
      type: APPOINTMENT_REMINDER_TYPES.checkOutEnd,
      title: "Visit ending now",
      body: `Your visit with ${who} on ${serviceDate} is ending now. Please complete remaining tasks and check out.`,
      target: end,
      forCheckIn: false,
    },
  ];
}

export async function processAppointmentReminders(
  options: { timeZone?: string; at?: Date } = {},
): Promise<{ sent: number }> {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const current = options.at ?? now();
  const today = calendarDateInTimeZone(current, timeZone);
  const from = addDays(today, -1);
  const to = addDays(today, 1);
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);

  const appointments = await prisma.appointment.findMany({
    where: {
      appointmentStatus: "scheduled",
      recordStatus: "active",
      scheduledDate: { lte: toDate },
      OR: [{ endDate: null }, { endDate: { gte: fromDate } }],
    },
    select: {
      id: true,
      caregiverId: true,
      scheduledDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      client: { select: { firstName: true, lastName: true } },
      dailyVisits: {
        where: { serviceDate: { gte: fromDate, lte: toDate } },
        select: {
          serviceDate: true,
          checkInAt: true,
          checkOutAt: true,
          completed: true,
          dailyVisitStatus: true,
        },
      },
    },
  });

  if (appointments.length === 0) {
    return { sent: 0 };
  }

  const reminderTypes = Object.values(APPOINTMENT_REMINDER_TYPES);
  const existing = await prisma.notification.findMany({
    where: {
      appointmentId: { in: appointments.map((row) => row.id) },
      type: { in: [...reminderTypes] },
    },
    select: { appointmentId: true, type: true, body: true },
  });
  const sentKeys = new Set<string>();
  for (const row of existing) {
    if (!row.appointmentId) {
      continue;
    }
    const match = SERVICE_DATE_IN_BODY.exec(row.body);
    if (match) {
      sentKeys.add(alreadySentKey(row.appointmentId, row.type, match[1]));
    }
  }

  let sent = 0;
  for (const appointment of appointments) {
    const start = nullableDate(appointment.scheduledDate);
    const end = nullableDate(appointment.endDate) ?? start;
    if (!start || !end) {
      continue;
    }
    const rangeStart = start < from ? from : start;
    const rangeEnd = end > to ? to : end;
    if (rangeStart > rangeEnd) {
      continue;
    }
    const who = clientName(appointment.client);
    const visitsByDate = new Map(
      appointment.dailyVisits.map((visit) => [formatDate(visit.serviceDate), visit]),
    );

    for (const serviceDate of eachDate(rangeStart, rangeEnd)) {
      const daily = visitsByDate.get(serviceDate);
      if (
        daily &&
        (daily.completed || TERMINAL_DAILY.has(daily.dailyVisitStatus) || daily.checkOutAt !== null)
      ) {
        continue;
      }
      const checkedIn = daily?.checkInAt != null;

      for (const reminder of remindersForVisit(
        serviceDate,
        appointment.startTime,
        appointment.endTime,
        who,
        timeZone,
      )) {
        if (!isDue(reminder.target, current)) {
          continue;
        }
        if (reminder.forCheckIn && checkedIn) {
          continue;
        }
        const key = alreadySentKey(appointment.id, reminder.type, serviceDate);
        if (sentKeys.has(key)) {
          continue;
        }

        try {
          await deliveringTransaction(async (tx) => {
            const duplicate = await tx.notification.findFirst({
              where: {
                userId: appointment.caregiverId,
                appointmentId: appointment.id,
                type: reminder.type,
                body: { contains: serviceDate },
              },
              select: { id: true },
            });
            if (duplicate) {
              sentKeys.add(key);
              return;
            }
            const id = randomUUID();
            await tx.notification.create({
              data: {
                id,
                userId: appointment.caregiverId,
                type: reminder.type,
                title: reminder.title,
                body: reminder.body,
                appointmentId: appointment.id,
                releaseId: null,
                createdAt: current,
              },
            });
            queueNotificationPushes([id]);
            sent += 1;
            sentKeys.add(key);
          });
        } catch (error) {
          logError("appointment reminder failed", {
            appointmentId: appointment.id,
            type: reminder.type,
            name: error instanceof Error ? error.name : "Error",
          });
        }
      }
    }
  }

  return { sent };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startAppointmentReminderScheduler(intervalMs = 60_000): void {
  if (timer || process.env.NODE_ENV === "test") {
    return;
  }
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await processAppointmentReminders();
    } catch (error) {
      logError("appointment reminder scheduler failed", {
        name: error instanceof Error ? error.name : "Error",
      });
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  void tick();
}

export function stopAppointmentReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
