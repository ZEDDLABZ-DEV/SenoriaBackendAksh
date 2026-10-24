-- Admin portal fields. Existing caregiver rows stay valid.
-- Widened checks are dropped and recreated with the same names.

ALTER TABLE "users" ADD COLUMN "position" TEXT;

ALTER TABLE "clients" ADD COLUMN "created_by_id" UUID;
ALTER TABLE "clients" ADD COLUMN "updated_by_id" UUID;

ALTER TABLE "service_requirements" ADD COLUMN "category" TEXT;
ALTER TABLE "service_requirements" ADD COLUMN "name" TEXT;
ALTER TABLE "service_requirements" ADD COLUMN "description" TEXT;
ALTER TABLE "service_requirements" ADD COLUMN "frequency" TEXT;
ALTER TABLE "service_requirements" ADD COLUMN "special_instructions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "service_requirements" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "care_plan_check_ins" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "care_plan_check_ins" ALTER COLUMN "longitude" DROP NOT NULL;

CREATE TABLE "caregiver_positions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "caregiver_positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caregiver_positions_name_key" ON "caregiver_positions"("name");

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_hazards" DROP CONSTRAINT "client_hazards_type_check";
ALTER TABLE "client_hazards" ADD CONSTRAINT "client_hazards_type_check" CHECK ("type" IN ('fall_risk', 'other', 'environmental_risks', 'medical_risks'));

ALTER TABLE "care_plans" DROP CONSTRAINT "care_plans_status_check";
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_status_check" CHECK ("status" IN ('active', 'inactive', 'completed'));

ALTER TABLE "appointments" DROP CONSTRAINT "appointments_type_check";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_check" CHECK ("appointment_type" IN ('personal_care', 'wellness_check', 'companionship', 'medication_support', 'doctor_visit', 'other', 'regular_visit'));

ALTER TABLE "appointments" DROP CONSTRAINT "appointments_cancelled_reason_check";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_reason_check" CHECK ("appointment_status" <> 'cancelled' OR "cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) > 0);

INSERT INTO "caregiver_positions" ("id", "name") VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Health Care Aide (HCA)'),
  ('a0000000-0000-4000-8000-000000000002', 'Care Aide / Personal Support Worker (PSW)'),
  ('a0000000-0000-4000-8000-000000000003', 'Community Support Worker'),
  ('a0000000-0000-4000-8000-000000000004', 'Companion Caregiver'),
  ('a0000000-0000-4000-8000-000000000005', 'Home Support Worker'),
  ('a0000000-0000-4000-8000-000000000006', 'Respite Care Worker'),
  ('a0000000-0000-4000-8000-000000000007', 'Registered Nurse (RN)'),
  ('a0000000-0000-4000-8000-000000000008', 'Licensed Practical Nurse (LPN)'),
  ('a0000000-0000-4000-8000-000000000009', 'Sales Closer'),
  ('a0000000-0000-4000-8000-000000000010', 'Client Acquisition Specialist'),
  ('a0000000-0000-4000-8000-000000000011', 'Other')
ON CONFLICT ("name") DO NOTHING;
