-- Sales calendar meetings. Deletes are soft so a lead timeline can still refer to them.

CREATE TABLE "sales_meetings" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_meetings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_meetings_owner_id_start_at_idx" ON "sales_meetings"("owner_id", "start_at");

ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_kind_check" CHECK ("kind" IN ('Call', 'Visit'));
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_title_check" CHECK (length(btrim("title")) > 0);
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_person_check" CHECK (length(btrim("person")) > 0);
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_time_order_check" CHECK ("end_at" > "start_at");
