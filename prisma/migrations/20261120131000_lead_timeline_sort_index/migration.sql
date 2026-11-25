-- Orders timeline events that share one timestamp.

ALTER TABLE "lead_timeline_events" ADD COLUMN "sort_index" INTEGER NOT NULL DEFAULT 0;
