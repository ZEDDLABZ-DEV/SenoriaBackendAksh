-- A caregiver can offer a scheduled visit to the other caregivers.
-- The visit stays assigned until another caregiver accepts it.

CREATE TABLE "appointment_releases" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "accepted_by_id" UUID,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "appointment_releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "release_id" UUID,
    "appointment_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointment_releases_appointment_id_status_idx" ON "appointment_releases"("appointment_id", "status");
CREATE INDEX "appointment_releases_requested_by_id_status_idx" ON "appointment_releases"("requested_by_id", "status");
CREATE INDEX "appointment_releases_status_created_at_idx" ON "appointment_releases"("status", "created_at");
CREATE UNIQUE INDEX "appointment_releases_one_open_idx" ON "appointment_releases"("appointment_id") WHERE "status" = 'open';

CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_release_id_idx" ON "notifications"("release_id");

ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "appointment_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_status_check" CHECK ("status" IN ('open', 'accepted', 'withdrawn', 'closed'));
ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_reason_check" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "appointment_releases" ADD CONSTRAINT "appointment_releases_state_check" CHECK (
    ("status" = 'open' AND "accepted_by_id" IS NULL AND "resolved_at" IS NULL)
    OR ("status" = 'accepted' AND "accepted_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
    OR ("status" IN ('withdrawn', 'closed') AND "accepted_by_id" IS NULL AND "resolved_at" IS NOT NULL)
);
