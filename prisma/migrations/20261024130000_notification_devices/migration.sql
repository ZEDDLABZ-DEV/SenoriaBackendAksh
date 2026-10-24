-- FCM registration tokens for caregivers. One token belongs to one caregiver.

CREATE TABLE "notification_devices" (
    "id" UUID NOT NULL,
    "caregiver_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_devices_token_key" ON "notification_devices"("token");
CREATE INDEX "notification_devices_caregiver_id_idx" ON "notification_devices"("caregiver_id");

ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_platform_check" CHECK ("platform" IN ('ios', 'android'));
