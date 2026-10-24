export const GENDER_VALUES = ["female", "male", "other"] as const;
export const APPOINTMENT_TYPE_VALUES = [
  "personal_care",
  "wellness_check",
  "companionship",
  "medication_support",
  "doctor_visit",
  "other",
  "regular_visit",
] as const;
export const HAZARD_WRITE_TYPES = ["environmental_risks", "medical_risks"] as const;
export const CARE_PLAN_STATUS_VALUES = ["active", "inactive", "completed"] as const;
export const MEDICATION_SCHEDULES = ["OD", "BD", "TDS", "QID", "PRN", "HS"] as const;
export const SERVICE_FREQUENCIES = [
  "daily",
  "weekly",
  "biweekly",
  "bi-weekly",
  "monthly",
  "asneeded",
  "as needed",
  "as-needed",
] as const;
export const HAZARD_TYPE_VALUES = ["fall_risk", "other"] as const;
export const SEVERITY_VALUES = ["low", "moderate", "high", "other"] as const;
export const PROFICIENCY_VALUES = ["native", "fluent", "intermediate", "basic", "other"] as const;
export const RECORD_STATUS_VALUES = ["active", "inactive"] as const;
export const APPOINTMENT_STATUS_VALUES = ["scheduled", "completed", "cancelled"] as const;
export const ITEM_TYPE_VALUES = ["task", "medication", "diet", "hygiene"] as const;
export const USER_ROLE_VALUES = ["CAREGIVER", "ADMIN"] as const;

export type Gender = (typeof GENDER_VALUES)[number];
export type AppointmentType = (typeof APPOINTMENT_TYPE_VALUES)[number];
export type HazardType = (typeof HAZARD_TYPE_VALUES)[number];
export type Severity = (typeof SEVERITY_VALUES)[number];
export type Proficiency = (typeof PROFICIENCY_VALUES)[number];
export type ItemType = (typeof ITEM_TYPE_VALUES)[number];

export class ClosedSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedSetError";
  }
}

function parseClosed<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ClosedSetError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function parseGender(value: string): Gender {
  return parseClosed(value, GENDER_VALUES, "gender");
}

export function parseAppointmentType(value: string): AppointmentType {
  return parseClosed(value, APPOINTMENT_TYPE_VALUES, "appointmentType");
}

export function parseHazardType(value: string): HazardType {
  return parseClosed(value, HAZARD_TYPE_VALUES, "hazard type");
}

export function parseSeverity(value: string): Severity {
  return parseClosed(value, SEVERITY_VALUES, "severity");
}

export function parseOptionalSeverity(value: string | null | undefined): Severity | null {
  if (value == null || value === "") {
    return null;
  }
  return parseSeverity(value);
}

export function parseProficiency(value: string): Proficiency {
  return parseClosed(value, PROFICIENCY_VALUES, "proficiency");
}

export function parseItemType(value: string): ItemType {
  return parseClosed(value, ITEM_TYPE_VALUES, "itemType");
}

export function adminNoteForOther(
  value: string,
  note: string | null | undefined,
  field: string,
): string | null {
  const trimmed = note?.trim() ?? "";
  if (value === "other") {
    if (!trimmed) {
      throw new ClosedSetError(`${field} requires an admin note when the value is other`);
    }
    return trimmed;
  }
  if (trimmed) {
    throw new ClosedSetError(`${field} note is stored only when the value is other`);
  }
  return null;
}
