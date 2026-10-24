-- Re-apply constraints that schema.prisma cannot represent.
-- This script does not drop constraints and does not modify existing rows.
-- Safe to run after every migrate deploy.

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('CAREGIVER', 'ADMIN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'inactive'));
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
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_releases_one_open_idx" ON "appointment_releases" ("appointment_id") WHERE "status" = 'open';
