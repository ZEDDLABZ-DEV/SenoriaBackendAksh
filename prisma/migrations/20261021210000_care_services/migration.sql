-- Visit services are chosen from a settings catalog when an appointment is created.

CREATE TABLE "care_services" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "care_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "care_services_name_key" ON "care_services"("name");

CREATE TABLE "appointment_services" (
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("appointment_id", "service_id")
);

CREATE INDEX "appointment_services_service_id_idx" ON "appointment_services"("service_id");

ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "care_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "care_services" ("id", "name") VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Bathing'),
  ('c0000000-0000-4000-8000-000000000002', 'Cooking'),
  ('c0000000-0000-4000-8000-000000000003', 'Companionship'),
  ('c0000000-0000-4000-8000-000000000004', 'Light housekeeping'),
  ('c0000000-0000-4000-8000-000000000005', 'Medication reminder'),
  ('c0000000-0000-4000-8000-000000000006', 'Wound care'),
  ('c0000000-0000-4000-8000-000000000007', 'Respite care'),
  ('c0000000-0000-4000-8000-000000000008', 'Dementia support'),
  ('c0000000-0000-4000-8000-000000000009', 'Fall prevention'),
  ('c0000000-0000-4000-8000-00000000000a', 'Transportation'),
  ('c0000000-0000-4000-8000-00000000000b', 'Appointment')
ON CONFLICT ("name") DO NOTHING;
