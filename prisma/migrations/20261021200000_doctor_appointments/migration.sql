-- Doctor appointments are a separate schedule from caregiver visits.
-- Status values are enforced in SQL. prisma/preserve-constraints.sql keeps the check.

CREATE TABLE "doctor_appointment_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doctor_appointment_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "doctor_appointment_types_name_key" ON "doctor_appointment_types"("name");

CREATE TABLE "doctor_appointments" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "doctor_name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "clinic_name" TEXT NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "doctor_appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "doctor_appointments_client_id_scheduled_date_idx" ON "doctor_appointments"("client_id", "scheduled_date");
CREATE INDEX "doctor_appointments_type_id_idx" ON "doctor_appointments"("type_id");
CREATE INDEX "doctor_appointments_status_idx" ON "doctor_appointments"("status");

ALTER TABLE "doctor_appointments" ADD CONSTRAINT "doctor_appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_appointments" ADD CONSTRAINT "doctor_appointments_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "doctor_appointment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_appointments" ADD CONSTRAINT "doctor_appointments_status_check" CHECK ("status" IN ('scheduled', 'completed', 'cancelled'));

INSERT INTO "doctor_appointment_types" ("id", "name") VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Doctor''s Appointment')
ON CONFLICT ("name") DO NOTHING;
