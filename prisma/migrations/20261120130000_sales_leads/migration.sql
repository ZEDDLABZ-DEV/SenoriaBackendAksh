-- Sales workspace leads, append-only timeline, and round-robin cursor.

CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'New',
    "owner_id" UUID,
    "about" TEXT NOT NULL DEFAULT '',
    "last_touch_at" TIMESTAMPTZ(6),
    "next_step" TEXT,
    "next_step_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_owner_id_stage_idx" ON "leads"("owner_id", "stage");
CREATE INDEX "leads_next_step_at_idx" ON "leads"("next_step_at");

ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_check" CHECK ("stage" IN ('New', 'Contacted', 'Qualified', 'Visit booked', 'Won', 'Lost'));
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_check" CHECK ("source" IN ('Facebook', 'Instagram', 'Phone', 'Referral'));
ALTER TABLE "leads" ADD CONSTRAINT "leads_first_name_check" CHECK (length(btrim("first_name")) > 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_last_name_check" CHECK (length(btrim("last_name")) > 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_phone_check" CHECK (length(btrim("phone")) > 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_email_check" CHECK ("email" IS NULL OR length(btrim("email")) > 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_next_step_check" CHECK ("next_step" IS NULL OR length(btrim("next_step")) > 0);

CREATE TABLE "lead_timeline_events" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_timeline_events_lead_id_occurred_at_idx" ON "lead_timeline_events"("lead_id", "occurred_at");

ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_kind_check" CHECK ("kind" IN ('Lead', 'Call', 'Note', 'Meeting', 'Stage', 'Assignment'));
ALTER TABLE "lead_timeline_events" ADD CONSTRAINT "lead_timeline_events_text_check" CHECK (length(btrim("text")) > 0);

CREATE TABLE "sales_round_robin_state" (
    "id" INTEGER NOT NULL,
    "last_assigned_user_id" UUID,

    CONSTRAINT "sales_round_robin_state_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_round_robin_state" ADD CONSTRAINT "sales_round_robin_state_singleton_check" CHECK ("id" = 1);
ALTER TABLE "sales_round_robin_state" ADD CONSTRAINT "sales_round_robin_state_last_assigned_user_id_fkey" FOREIGN KEY ("last_assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "sales_round_robin_state" ("id", "last_assigned_user_id") VALUES (1, NULL);
