-- Nullable external sync fields. No vendor is contacted. Existing rows stay null.

ALTER TABLE "leads" ADD COLUMN "external_source" TEXT;
ALTER TABLE "leads" ADD COLUMN "external_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "last_synced_at" TIMESTAMPTZ(6);
ALTER TABLE "leads" ADD COLUMN "sync_error" TEXT;

ALTER TABLE "lead_timeline_events" ADD COLUMN "external_source" TEXT;
ALTER TABLE "lead_timeline_events" ADD COLUMN "external_id" TEXT;
ALTER TABLE "lead_timeline_events" ADD COLUMN "last_synced_at" TIMESTAMPTZ(6);
ALTER TABLE "lead_timeline_events" ADD COLUMN "sync_error" TEXT;

ALTER TABLE "sales_calls" ADD COLUMN "external_source" TEXT;
ALTER TABLE "sales_calls" ADD COLUMN "external_id" TEXT;
ALTER TABLE "sales_calls" ADD COLUMN "last_synced_at" TIMESTAMPTZ(6);
ALTER TABLE "sales_calls" ADD COLUMN "sync_error" TEXT;

ALTER TABLE "sales_meetings" ADD COLUMN "external_source" TEXT;
ALTER TABLE "sales_meetings" ADD COLUMN "external_id" TEXT;
ALTER TABLE "sales_meetings" ADD COLUMN "last_synced_at" TIMESTAMPTZ(6);
ALTER TABLE "sales_meetings" ADD COLUMN "sync_error" TEXT;

ALTER TABLE "leads" ADD CONSTRAINT "leads_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
ALTER TABLE "leads" ADD CONSTRAINT "leads_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
CREATE UNIQUE INDEX "leads_external_source_id_key" ON "leads" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
CREATE UNIQUE INDEX "lead_timeline_events_external_source_id_key" ON "lead_timeline_events" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
ALTER TABLE "sales_calls" ADD CONSTRAINT "sales_calls_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
CREATE UNIQUE INDEX "sales_calls_external_source_id_key" ON "sales_calls" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_external_source_check" CHECK ("external_source" IS NULL OR "external_source" IN ('meta', 'ringcentral', 'zoho', 'outlook'));
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_external_pair_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND length(btrim("external_source")) > 0 AND length(btrim("external_id")) > 0));
CREATE UNIQUE INDEX "sales_meetings_external_source_id_key" ON "sales_meetings" ("external_source", "external_id") WHERE "external_id" IS NOT NULL;
