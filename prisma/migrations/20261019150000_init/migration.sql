-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "avatar" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "profile_image" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "address_street" TEXT NOT NULL DEFAULT '',
    "address_apartment" TEXT NOT NULL DEFAULT '',
    "address_city" TEXT NOT NULL DEFAULT '',
    "address_state" TEXT NOT NULL DEFAULT '',
    "address_zip_code" TEXT NOT NULL DEFAULT '',
    "address_country" TEXT NOT NULL DEFAULT '',
    "gate_access_code" TEXT NOT NULL DEFAULT '',
    "navigation_instructions" TEXT NOT NULL DEFAULT '',
    "gender_other_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_client_assignments" (
    "id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_client_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_languages" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "proficiency" TEXT NOT NULL,
    "proficiency_other_note" TEXT,
    "is_primary" BOOLEAN NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "is_primary" BOOLEAN NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icd_code" TEXT,
    "diagnosed_date" DATE,
    "severity" TEXT,
    "severity_other_note" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_hazards" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "type_other_note" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL,
    "severity_other_note" TEXT,
    "precautions" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "client_hazards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requirements" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "start_on" DATE,
    "end_on" DATE,

    CONSTRAINT "service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_plans" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "start_date" DATE,
    "end_date" DATE,

    CONSTRAINT "care_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_plan_goals" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "care_plan_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_tasks" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "care_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_medications" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "medication_name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL DEFAULT '',
    "schedule" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "care_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_diet_instructions" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "meal" TEXT NOT NULL,
    "restrictions" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "care_diet_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_hygiene_instructions" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "activity" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "care_hygiene_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_item_completions" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "care_item_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "care_plan_id" UUID,
    "description" TEXT NOT NULL DEFAULT '',
    "scheduled_date" DATE,
    "end_date" DATE,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "appointment_type" TEXT NOT NULL,
    "appointment_type_other_note" TEXT,
    "appointment_status" TEXT NOT NULL,
    "record_status" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "cancellation_reason" TEXT,
    "location_street" TEXT NOT NULL DEFAULT '',
    "location_city" TEXT NOT NULL DEFAULT '',
    "location_state" TEXT NOT NULL DEFAULT '',
    "location_zip_code" TEXT NOT NULL DEFAULT '',
    "location_gate_code" TEXT,
    "location_navigation" TEXT NOT NULL DEFAULT '',
    "doctor_name" TEXT,
    "doctor_specialty" TEXT,
    "doctor_phone" TEXT,
    "clinic_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_daily_visits" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "daily_visit_status" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL,
    "check_in_at" TIMESTAMPTZ(6),
    "check_out_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,

    CONSTRAINT "appointment_daily_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_plan_check_ins" (
    "id" UUID NOT NULL,
    "care_plan_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL,
    "service_date" DATE NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "care_plan_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_last_name_first_name_idx" ON "clients"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "caregiver_client_assignments_client_id_idx" ON "caregiver_client_assignments"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_client_assignments_caregiver_id_client_id_key" ON "caregiver_client_assignments"("caregiver_id", "client_id");

-- CreateIndex
CREATE INDEX "client_languages_client_id_idx" ON "client_languages"("client_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_client_id_idx" ON "emergency_contacts"("client_id");

-- CreateIndex
CREATE INDEX "diagnoses_client_id_idx" ON "diagnoses"("client_id");

-- CreateIndex
CREATE INDEX "client_hazards_client_id_idx" ON "client_hazards"("client_id");

-- CreateIndex
CREATE INDEX "service_requirements_client_id_idx" ON "service_requirements"("client_id");

-- CreateIndex
CREATE INDEX "care_plans_client_id_idx" ON "care_plans"("client_id");

-- CreateIndex
CREATE INDEX "care_plan_goals_care_plan_id_idx" ON "care_plan_goals"("care_plan_id");

-- CreateIndex
CREATE INDEX "care_tasks_care_plan_id_idx" ON "care_tasks"("care_plan_id");

-- CreateIndex
CREATE INDEX "care_medications_care_plan_id_idx" ON "care_medications"("care_plan_id");

-- CreateIndex
CREATE INDEX "care_diet_instructions_care_plan_id_idx" ON "care_diet_instructions"("care_plan_id");

-- CreateIndex
CREATE INDEX "care_hygiene_instructions_care_plan_id_idx" ON "care_hygiene_instructions"("care_plan_id");

-- CreateIndex
CREATE INDEX "care_item_completions_care_plan_id_service_date_idx" ON "care_item_completions"("care_plan_id", "service_date");

-- CreateIndex
CREATE UNIQUE INDEX "care_item_completions_item_type_item_id_service_date_key" ON "care_item_completions"("item_type", "item_id", "service_date");

-- CreateIndex
CREATE INDEX "appointments_caregiver_id_scheduled_date_idx" ON "appointments"("caregiver_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "appointments_client_id_scheduled_date_idx" ON "appointments"("client_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "appointments_appointment_status_idx" ON "appointments"("appointment_status");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_daily_visits_appointment_id_service_date_key" ON "appointment_daily_visits"("appointment_id", "service_date");

-- CreateIndex
CREATE INDEX "care_plan_check_ins_care_plan_id_service_date_idx" ON "care_plan_check_ins"("care_plan_id", "service_date");

-- CreateIndex
CREATE INDEX "care_plan_check_ins_appointment_id_service_date_idx" ON "care_plan_check_ins"("appointment_id", "service_date");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_client_assignments" ADD CONSTRAINT "caregiver_client_assignments_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_client_assignments" ADD CONSTRAINT "caregiver_client_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_languages" ADD CONSTRAINT "client_languages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_hazards" ADD CONSTRAINT "client_hazards_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_plan_goals" ADD CONSTRAINT "care_plan_goals_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_tasks" ADD CONSTRAINT "care_tasks_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_medications" ADD CONSTRAINT "care_medications_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_diet_instructions" ADD CONSTRAINT "care_diet_instructions_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_hygiene_instructions" ADD CONSTRAINT "care_hygiene_instructions_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_item_completions" ADD CONSTRAINT "care_item_completions_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_item_completions" ADD CONSTRAINT "care_item_completions_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_daily_visits" ADD CONSTRAINT "appointment_daily_visits_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_plan_check_ins" ADD CONSTRAINT "care_plan_check_ins_care_plan_id_fkey" FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_plan_check_ins" ADD CONSTRAINT "care_plan_check_ins_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_plan_check_ins" ADD CONSTRAINT "care_plan_check_ins_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Closed sets and invariants. Caregiver JSON never includes the admin-only note columns.
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));

ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('CAREGIVER', 'ADMIN'));
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'inactive'));

ALTER TABLE "clients" ADD CONSTRAINT "clients_gender_check" CHECK ("gender" IN ('female', 'male', 'other'));
ALTER TABLE "clients" ADD CONSTRAINT "clients_status_check" CHECK ("status" IN ('active', 'inactive'));

ALTER TABLE "client_languages" ADD CONSTRAINT "client_languages_proficiency_check" CHECK ("proficiency" IN ('native', 'fluent', 'intermediate', 'basic', 'other'));

ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_severity_check" CHECK ("severity" IS NULL OR "severity" IN ('low', 'moderate', 'high', 'other'));

ALTER TABLE "client_hazards" ADD CONSTRAINT "client_hazards_type_check" CHECK ("type" IN ('fall_risk', 'other'));
ALTER TABLE "client_hazards" ADD CONSTRAINT "client_hazards_severity_check" CHECK ("severity" IN ('low', 'moderate', 'high', 'other'));

ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_status_check" CHECK ("status" IN ('active', 'inactive'));

ALTER TABLE "care_item_completions" ADD CONSTRAINT "care_item_completions_item_type_check" CHECK ("item_type" IN ('task', 'medication', 'diet', 'hygiene'));

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_check" CHECK ("appointment_type" IN ('personal_care', 'wellness_check', 'companionship', 'medication_support', 'doctor_visit', 'other'));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_check" CHECK ("appointment_status" IN ('scheduled', 'completed', 'cancelled'));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_record_status_check" CHECK ("record_status" IN ('active', 'inactive'));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_reason_check" CHECK ("appointment_status" <> 'cancelled' OR ("cancellation_reason" IS NOT NULL AND length(btrim("cancellation_reason")) > 0));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_date_order_check" CHECK ("end_date" IS NULL OR "scheduled_date" IS NULL OR "end_date" >= "scheduled_date");

ALTER TABLE "appointment_daily_visits" ADD CONSTRAINT "appointment_daily_visits_status_check" CHECK ("daily_visit_status" IN ('pending', 'in_progress', 'ongoing', 'completed', 'cancelled', 'canceled', 'missed'));

