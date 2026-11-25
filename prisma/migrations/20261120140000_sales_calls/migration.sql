-- Logged sales calls. Recording URLs stay empty until a later telephony sync.

CREATE TABLE "sales_calls" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "owner_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,
    "result" TEXT NOT NULL,
    "recording_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_calls_lead_id_idx" ON "sales_calls"("lead_id");
CREATE INDEX "sales_calls_started_at_idx" ON "sales_calls"("started_at");

ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_direction_check" CHECK ("direction" IN ('Outbound', 'Inbound'));
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_result_check" CHECK ("result" IN ('Connected', 'No answer', 'Voicemail', 'Missed'));
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_name_check" CHECK (length(btrim("name")) > 0);
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_phone_check" CHECK (length(btrim("phone")) > 0);
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_time_order_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
