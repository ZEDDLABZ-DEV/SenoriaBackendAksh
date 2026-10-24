-- Caregiver schedule: weekly availability, time off, and recurring visit series.
-- Series occurrences are ordinary appointments linked by series_id, series_date, and series_slot.

ALTER TABLE "appointments" ADD COLUMN     "is_exception" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "series_date" DATE,
ADD COLUMN     "series_id" UUID,
ADD COLUMN     "series_slot" INTEGER;

CREATE TABLE "caregiver_availability" (
    "id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,

    CONSTRAINT "caregiver_availability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "caregiver_time_off" (
    "id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_time_off_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visit_series" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "weekdays" INTEGER[],
    "time_slots" JSONB NOT NULL,
    "service_ids" UUID[],
    "appointment_type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "location_street" TEXT NOT NULL DEFAULT '',
    "location_city" TEXT NOT NULL DEFAULT '',
    "location_state" TEXT NOT NULL DEFAULT '',
    "location_zip_code" TEXT NOT NULL DEFAULT '',
    "location_gate_code" TEXT NOT NULL DEFAULT '',
    "location_navigation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "visit_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visit_series_exclusions" (
    "series_id" UUID NOT NULL,
    "series_date" DATE NOT NULL,
    "series_slot" INTEGER NOT NULL,

    CONSTRAINT "visit_series_exclusions_pkey" PRIMARY KEY ("series_id","series_date","series_slot")
);

CREATE INDEX "caregiver_availability_caregiver_id_weekday_idx" ON "caregiver_availability"("caregiver_id", "weekday");
CREATE INDEX "caregiver_time_off_caregiver_id_start_date_idx" ON "caregiver_time_off"("caregiver_id", "start_date");
CREATE INDEX "visit_series_caregiver_id_start_date_idx" ON "visit_series"("caregiver_id", "start_date");
CREATE INDEX "visit_series_client_id_idx" ON "visit_series"("client_id");
CREATE UNIQUE INDEX "appointments_series_id_series_date_series_slot_key" ON "appointments"("series_id", "series_date", "series_slot");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "visit_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_series" ADD CONSTRAINT "visit_series_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_series" ADD CONSTRAINT "visit_series_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_series_exclusions" ADD CONSTRAINT "visit_series_exclusions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "visit_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_time_order_check" CHECK ("end_time" > "start_time");
ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_date_order_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_time_check" CHECK (("start_time" IS NULL AND "end_time" IS NULL) OR ("start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "end_time" > "start_time"));
ALTER TABLE "visit_series" ADD CONSTRAINT "visit_series_status_check" CHECK ("status" IN ('active', 'ended'));
ALTER TABLE "visit_series" ADD CONSTRAINT "visit_series_date_order_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_fields_check" CHECK (("series_id" IS NULL AND "series_date" IS NULL AND "series_slot" IS NULL) OR ("series_id" IS NOT NULL AND "series_date" IS NOT NULL AND "series_slot" IS NOT NULL));
