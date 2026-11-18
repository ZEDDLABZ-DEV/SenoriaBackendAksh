-- Caregivers can request account deletion from the app.
-- While a request is pending the user status is deletion_pending and login is blocked.
-- Admins approve (deactivate) or reject (restore active) the request.

ALTER TABLE "users" DROP CONSTRAINT "users_status_check";
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'inactive', 'deletion_pending'));

CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_deletion_requests_status_created_at_idx" ON "account_deletion_requests"("status", "created_at");
CREATE INDEX "account_deletion_requests_user_id_status_idx" ON "account_deletion_requests"("user_id", "status");
CREATE UNIQUE INDEX "account_deletion_requests_one_pending_idx" ON "account_deletion_requests"("user_id") WHERE "status" = 'pending';

ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_reason_check" CHECK ("reason" IS NULL OR length(btrim("reason")) > 0);
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_state_check" CHECK (
    ("status" = 'pending' AND "reviewed_by_id" IS NULL AND "resolved_at" IS NULL)
    OR ("status" IN ('approved', 'rejected') AND "reviewed_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
);
