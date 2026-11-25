-- Sales accounts. date_of_birth is collected for SALES and stays null for other roles.
-- The role check is widened and recreated with the same name.

ALTER TABLE "users" ADD COLUMN "date_of_birth" DATE;

ALTER TABLE "users" DROP CONSTRAINT "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('CAREGIVER', 'ADMIN', 'SALES'));
