export interface VisitRow {
  serviceDate: string;
  dailyVisitStatus: string;
  completed: boolean;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}

export interface AppointmentStateInput {
  appointmentStatus: string;
  recordStatus: string;
  scheduledDate: string | null;
  endDate: string | null;
  cancellationReason: string | null;
}

export interface VisitPresentation {
  completedToday: boolean;
  activeToday: boolean;
  dailyVisitStatus: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  cancellationReason: string | null;
}

const BLOCKED_DAILY = new Set(["cancelled", "canceled", "missed"]);

function timestamp(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function findVisit(visits: VisitRow[], date: string): VisitRow | undefined {
  return visits.find((visit) => visit.serviceDate === date);
}

function latestVisit(visits: VisitRow[]): VisitRow | undefined {
  return [...visits].sort((left, right) => left.serviceDate.localeCompare(right.serviceDate)).at(-1);
}

export function presentVisit(
  appointment: AppointmentStateInput,
  visits: VisitRow[],
  today: string,
): VisitPresentation {
  const start = appointment.scheduledDate;
  const end = appointment.endDate ?? appointment.scheduledDate;

  if (appointment.appointmentStatus === "cancelled") {
    const row =
      start && end && today >= start && today <= end ? findVisit(visits, today) : latestVisit(visits);
    return {
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: "cancelled",
      checkInTime: timestamp(row?.checkInAt),
      checkOutTime: timestamp(row?.checkOutAt),
      cancellationReason: appointment.cancellationReason,
    };
  }

  if (!start || !end) {
    return {
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: "",
      checkInTime: null,
      checkOutTime: null,
      cancellationReason: null,
    };
  }

  if (today < start) {
    return {
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: "pending",
      checkInTime: null,
      checkOutTime: null,
      cancellationReason: null,
    };
  }

  if (today > end) {
    const row = findVisit(visits, end) ?? latestVisit(visits);
    const status =
      appointment.appointmentStatus === "completed"
        ? "completed"
        : (row?.dailyVisitStatus ?? "pending");
    return {
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: status,
      checkInTime: timestamp(row?.checkInAt),
      checkOutTime: timestamp(row?.checkOutAt),
      cancellationReason: null,
    };
  }

  const row = findVisit(visits, today);
  if (appointment.appointmentStatus === "completed") {
    return {
      completedToday: true,
      activeToday: false,
      dailyVisitStatus: "completed",
      checkInTime: timestamp(row?.checkInAt),
      checkOutTime: timestamp(row?.checkOutAt),
      cancellationReason: null,
    };
  }

  if (!row) {
    const actionable =
      appointment.recordStatus === "active" && appointment.appointmentStatus === "scheduled";
    return {
      completedToday: false,
      activeToday: actionable,
      dailyVisitStatus: "pending",
      checkInTime: null,
      checkOutTime: null,
      cancellationReason: null,
    };
  }

  const status = row.dailyVisitStatus || "pending";
  const completed = row.completed || status.toLowerCase() === "completed";
  const blocked = BLOCKED_DAILY.has(status.toLowerCase());
  const actionable =
    appointment.recordStatus === "active" &&
    appointment.appointmentStatus === "scheduled" &&
    !completed &&
    !blocked;

  return {
    completedToday: completed,
    activeToday: actionable,
    dailyVisitStatus: status,
    checkInTime: timestamp(row.checkInAt),
    checkOutTime: timestamp(row.checkOutAt),
    cancellationReason: null,
  };
}
