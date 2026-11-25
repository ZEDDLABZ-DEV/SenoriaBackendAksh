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
  "account_deletion_requests_status_check",
  "account_deletion_requests_reason_check",
  "account_deletion_requests_state_check",
  "account_deletion_requests_one_pending_idx",
  "leads_stage_check",
  "leads_source_check",
  "leads_first_name_check",
  "leads_last_name_check",
  "leads_phone_check",
  "leads_email_check",
  "leads_next_step_check",
  "lead_timeline_events_kind_check",
  "lead_timeline_events_text_check",
  "sales_round_robin_state_singleton_check",
  "sales_calls_direction_check",
  "sales_calls_result_check",
  "sales_calls_name_check",
  "sales_calls_phone_check",
  "sales_calls_duration_check",
  "sales_calls_time_order_check",
  "sales_meetings_kind_check",
  "sales_meetings_title_check",
  "sales_meetings_person_check",
  "sales_meetings_time_order_check",
  "leads_external_source_check",
  "leads_external_pair_check",
  "leads_external_source_id_key",
  "lead_timeline_events_external_source_check",
  "lead_timeline_events_external_pair_check",
  "lead_timeline_events_external_source_id_key",
  "sales_calls_external_source_check",
  "sales_calls_external_pair_check",
  "sales_calls_external_source_id_key",
  "sales_meetings_external_source_check",
  "sales_meetings_external_pair_check",
  "sales_meetings_external_source_id_key",
  "leads_zoho_record_id_check",
  "leads_zoho_record_id_key",
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
