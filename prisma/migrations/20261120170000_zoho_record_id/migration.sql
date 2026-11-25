-- Zoho CRM record id for a Senoria lead. Meta external ids are left unchanged.

ALTER TABLE "leads" ADD COLUMN "zoho_record_id" TEXT;

ALTER TABLE "leads" ADD CONSTRAINT "leads_zoho_record_id_check" CHECK ("zoho_record_id" IS NULL OR length(btrim("zoho_record_id")) > 0);

CREATE UNIQUE INDEX "leads_zoho_record_id_key" ON "leads" ("zoho_record_id") WHERE "zoho_record_id" IS NOT NULL;
