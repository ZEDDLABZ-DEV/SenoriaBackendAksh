-- Access-token generation. Incrementing this value invalidates JWTs issued earlier.
-- Existing rows receive 0, which matches tokens that do not yet carry a session version.
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
