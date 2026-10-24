-- Admin hour corrections for one completed day. The caregiver check-in and
-- completion times on appointment_daily_visits are not updated.

CREATE TABLE "visit_hour_adjustments" (
    "id" UUID NOT NULL,
    "daily_visit_id" UUID NOT NULL,
    "adjusted_hours" DECIMAL(4,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visit_hour_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_hour_adjustments_daily_visit_id_created_at_idx" ON "visit_hour_adjustments"("daily_visit_id", "created_at");

ALTER TABLE "visit_hour_adjustments" ADD CONSTRAINT "visit_hour_adjustments_daily_visit_id_fkey" FOREIGN KEY ("daily_visit_id") REFERENCES "appointment_daily_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_hour_adjustments" ADD CONSTRAINT "visit_hour_adjustments_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_hour_adjustments" ADD CONSTRAINT "visit_hour_adjustments_hours_check" CHECK ("adjusted_hours" >= 0 AND "adjusted_hours" <= 24);
