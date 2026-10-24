-- Exact dates for a visit series. An empty array means the series still repeats by weekday.

ALTER TABLE "visit_series" ADD COLUMN "selected_dates" DATE[] NOT NULL DEFAULT ARRAY[]::DATE[];
