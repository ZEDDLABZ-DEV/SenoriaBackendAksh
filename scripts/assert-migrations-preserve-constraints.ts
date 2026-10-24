import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "prisma", "migrations");
const preservePath = path.join(root, "prisma", "preserve-constraints.sql");

const protectedNames = [
  "users_email_lower_idx",
  "users_role_check",
  "users_status_check",
  "clients_gender_check",
  "clients_status_check",
  "client_languages_proficiency_check",
  "diagnoses_severity_check",
  "client_hazards_type_check",
  "client_hazards_severity_check",
  "care_plans_status_check",
  "care_item_completions_item_type_check",
  "appointments_type_check",
  "appointments_status_check",
  "appointments_record_status_check",
  "appointments_cancelled_reason_check",
  "appointments_date_order_check",
  "appointment_daily_visits_status_check",
  "doctor_appointments_status_check",
  "visit_hour_adjustments_hours_check",
  "caregiver_availability_weekday_check",
  "caregiver_availability_time_order_check",
  "caregiver_time_off_date_order_check",
  "caregiver_time_off_time_check",
  "visit_series_status_check",
  "visit_series_date_order_check",
  "appointments_series_fields_check",
  "appointment_releases_status_check",
  "appointment_releases_reason_check",
  "appointment_releases_state_check",
  "appointment_releases_one_open_idx",
  "notification_devices_platform_check",
];

const dropPattern =
  /DROP\s+(?:CONSTRAINT|INDEX)(?:\s+IF\s+EXISTS)?\s+"?([A-Za-z0-9_]+)"?/gi;

const preserveSql = readFileSync(preservePath, "utf8");
const missingFromPreserve = protectedNames.filter((name) => !preserveSql.includes(name));
if (missingFromPreserve.length > 0) {
  throw new Error(
    `prisma/preserve-constraints.sql is missing: ${missingFromPreserve.join(", ")}`,
  );
}

const migrationFiles: string[] = [];
for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const file = path.join(migrationsDir, entry.name, "migration.sql");
  migrationFiles.push(file);
}

const violations: string[] = [];
for (const file of migrationFiles) {
  const sql = readFileSync(file, "utf8");
  for (const match of sql.matchAll(dropPattern)) {
    const name = match[1];
    if (!protectedNames.includes(name)) {
      continue;
    }
    const recreated = new RegExp(`ADD\\s+CONSTRAINT\\s+"${name}"`, "i").test(sql);
    if (!recreated) {
      violations.push(`${path.relative(root, file)} drops ${name}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Migrations must keep existing database constraints.\n${violations.join("\n")}`,
  );
}

console.log(`Checked ${migrationFiles.length} migrations. Protected constraints are not dropped.`);
