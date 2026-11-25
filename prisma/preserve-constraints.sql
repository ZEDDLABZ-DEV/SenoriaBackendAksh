-- Re-apply constraints that schema.prisma cannot represent.
-- This script does not drop constraints and does not modify existing rows.
-- Safe to run after every migrate deploy.

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('CAREGIVER', 'ADMIN', 'SALES'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'inactive', 'deletion_pending'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_gender_check') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_gender_check" CHECK ("gender" IN ('female', 'male', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_status_check') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_status_check" CHECK ("status" IN ('active', 'inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_languages_proficiency_check') THEN
    ALTER TABLE "client_languages" ADD CONSTRAINT "client_languages_proficiency_check" CHECK ("proficiency" IN ('native', 'fluent', 'intermediate', 'basic', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnoses_severity_check') THEN
    ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_severity_check" CHECK ("severity" IS NULL OR "severity" IN ('low', 'moderate', 'high', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_hazards_type_check') THEN
    ALTER TABLE "client_hazards" ADD CONSTRAINT "client_hazards_type_check" CHECK ("type" IN ('fall_risk', 'other', 'environmental_risks', 'medical_risks'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_hazards_severity_check') THEN
    ALTER TABLE "client_hazards" ADD CONSTRAINT "client_hazards_severity_check" CHECK ("severity" IN ('low', 'moderate', 'high', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'care_plans_status_check') THEN
    ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_status_check" CHECK ("status" IN ('active', 'inactive', 'completed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'care_item_completions_item_type_check') THEN
    ALTER TABLE "care_item_completions" ADD CONSTRAINT "care_item_completions_item_type_check" CHECK ("item_type" IN ('task', 'medication', 'diet', 'hygiene'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_type_check') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_check" CHECK ("appointment_type" IN ('personal_care', 'wellness_check', 'companionship', 'medication_support', 'doctor_visit', 'other', 'regular_visit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_check') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_check" CHECK ("appointment_status" IN ('scheduled', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_record_status_check') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_record_status_check" CHECK ("record_status" IN ('active', 'inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_cancelled_reason_check') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_reason_check" CHECK ("appointment_status" <> 'cancelled' OR "cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_date_order_check') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_date_order_check" CHECK ("end_date" IS NULL OR "scheduled_date" IS NULL OR "end_date" >= "scheduled_date");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_daily_visits_status_check') THEN
    ALTER TABLE "appointment_daily_visits" ADD CONSTRAINT "appointment_daily_visits_status_check" CHECK ("daily_visit_status" IN ('pending', 'in_progress', 'ongoing', 'completed', 'cancelled', 'canceled', 'missed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doctor_appointments_status_check') THEN
    ALTER TABLE "doctor_appointments" ADD CONSTRAINT "doctor_appointments_status_check" CHECK ("status" IN ('scheduled', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_hour_adjustments_hours_check') THEN
    ALTER TABLE "visit_hour_adjustments" ADD CONSTRAINT "visit_hour_adjustments_hours_check" CHECK ("adjusted_hours" >= 0 AND "adjusted_hours" <= 24);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caregiver_availability_weekday_check') THEN
    ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caregiver_availability_time_order_check') THEN
    ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_time_order_check" CHECK ("end_time" > "start_time");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caregiver_time_off_date_order_check') THEN
    ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_date_order_check" CHECK ("end_date" >= "start_date");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caregiver_time_off_time_check') THEN
    ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_time_check" CHECK (("start_time" IS NULL AND "end_time" IS NULL) OR ("start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "end_time" > "start_time"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_series_status_check') THEN
    ALTER TABLE "visit_series" ADD CONSTRAINT "visit_series_status_check" CHECK ("status" IN ('active', 'ended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_series_date_order_check') THEN
    ALTER TABLE "visit_series" ADD CONSTRAINT "visit_series_date_order_check" CHECK ("end_date" >= "start_date");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_series_fields_check') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_fields_check" CHECK (("series_id" IS NULL AND "series_date" IS NULL AND "series_slot" IS NULL) OR ("series_id" IS NOT NULL AND "series_date" IS NOT NULL AND "series_slot" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_releases_status_check') THEN
    ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_status_check" CHECK ("status" IN ('open', 'accepted', 'withdrawn', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_releases_reason_check') THEN
    ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_reason_check" CHECK (length(btrim("reason")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_releases_state_check') THEN
    ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_state_check" CHECK (
      ("status" = 'open' AND "accepted_by_id" IS NULL AND "resolved_at" IS NULL)
      OR ("status" = 'accepted' AND "accepted_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
      OR ("status" IN ('withdrawn', 'closed') AND "accepted_by_id" IS NULL AND "resolved_at" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_devices_platform_check') THEN
    ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_platform_check" CHECK ("platform" IN ('ios', 'android'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_requests_status_check') THEN
    ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_requests_reason_check') THEN
    ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_reason_check" CHECK ("reason" IS NULL OR length(btrim("reason")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_requests_state_check') THEN
    ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_state_check" CHECK (
      ("status" = 'pending' AND "reviewed_by_id" IS NULL AND "resolved_at" IS NULL)
      OR ("status" IN ('approved', 'rejected') AND "reviewed_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_stage_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_check" CHECK ("stage" IN ('New', 'Contacted', 'Qualified', 'Visit booked', 'Won', 'Lost'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_source_check" CHECK ("source" IN ('Facebook', 'Instagram', 'Phone', 'Referral'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_first_name_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_first_name_check" CHECK (length(btrim("first_name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_last_name_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_last_name_check" CHECK (length(btrim("last_name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_phone_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_phone_check" CHECK (length(btrim("phone")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_email_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_email_check" CHECK ("email" IS NULL OR length(btrim("email")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_next_step_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_next_step_check" CHECK ("next_step" IS NULL OR length(btrim("next_step")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_timeline_events_kind_check') THEN
    ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_kind_check" CHECK ("kind" IN ('Lead', 'Call', 'Note', 'Meeting', 'Stage', 'Assignment'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_timeline_events_text_check') THEN
    ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_text_check" CHECK (length(btrim("text")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_round_robin_state_singleton_check') THEN
    ALTER TABLE "sales_round_robin_state" ADD CONSTRAINT "sales_round_robin_state_singleton_check" CHECK ("id" = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_direction_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_direction_check" CHECK ("direction" IN ('Outbound', 'Inbound'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_result_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_result_check" CHECK ("result" IN ('Connected', 'No answer', 'Voicemail', 'Missed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_name_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_name_check" CHECK (length(btrim("name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_phone_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_phone_check" CHECK (length(btrim("phone")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_duration_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_time_order_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_time_order_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_meetings_kind_check') THEN
    ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_kind_check" CHECK ("kind" IN ('Call', 'Visit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_meetings_title_check') THEN
    ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_title_check" CHECK (length(btrim("title")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_meetings_person_check') THEN
    ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_person_check" CHECK (length(btrim("person")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_meetings_time_order_check') THEN
    ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_time_order_check" CHECK ("end_at" > "start_at");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_external_source_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_external_pair_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_timeline_events_external_source_check') THEN
    ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_timeline_events_external_pair_check') THEN
    ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_external_source_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_calls_external_pair_check') THEN
    ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_meetings_external_source_check') THEN
    ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_meetings_external_pair_check') THEN
    ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_zoho_record_id_check') THEN
    ALTER TABLE "leads" ADD CONSTRAINT "leads_zoho_record_id_check" CHECK ("zoho_record_id" IS NULL OR length(btrim("zoho_record_id")) > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_releases_one_open_idx" ON "appointment_releases" ("appointment_id") WHERE "status" = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_requests_one_pending_idx" ON "account_deletion_requests" ("user_id") WHERE "status" = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS "leads_external_source_id_key" ON "leads" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "lead_timeline_events_external_source_id_key" ON "lead_timeline_events" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sales_calls_external_source_id_key" ON "sales_calls" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sales_meetings_external_source_id_key" ON "sales_meetings" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "leads_zoho_record_id_key" ON "leads" ("zoho_record_id") WHERE "zoho_record_id" IS NOT NULL;