# Deployment

Run the API behind TLS. PostgreSQL must accept connections only from the API, not from the public internet or from either frontend.

## Process

1. Build: `npm ci`, then `npm run build`.
2. Set the environment from `.env.example`. Use a long random `JWT_SECRET` and a different long random `REFRESH_TOKEN_PEPPER`.
3. Set `NODE_ENV=production`, `DATABASE_URL`, and `CORS_ORIGINS` to the admin portal origin. Leave CORS empty if no browser client is deployed. The Flutter app does not need CORS.
4. Apply migrations with `npm run db:migrate` (`prisma migrate deploy`). Take a database backup before the first migration against a database that already has caregiver data. The migration creates tables. It does not truncate them.
5. Create the first administrator with `npm run admin:bootstrap` and the `ADMIN_*` variables. Do not pass those variables on a command line that is recorded in shell history if you can avoid it; prefer a secret store. The command refuses to replace an existing administrator.
6. Start with `npm start`. The process listens on `PORT` (default 3000).

## Health and logs

`GET /health` checks PostgreSQL. Logs are single-line JSON with method, path, status, and duration. They do not include bodies, passwords, access tokens, or refresh tokens.

## Tokens and passwords

- Access tokens are HS256 JWTs and expire after 24 hours.
- Refresh tokens are random 32-byte values. Only their SHA-256 hash, keyed with `REFRESH_TOKEN_PEPPER`, is stored. They expire after 30 days and rotate on every refresh.
- Passwords are Argon2id (19 MiB memory, time cost 2) outside the test environment.
- Deactivating a user makes the next caregiver request and the next refresh return 401.

## What not to do

- Do not run `prisma migrate reset` or the test suite against the production database.
- Do not point `TEST_DATABASE_URL` at production. Tests refuse a URL that does not contain `test`, and they truncate the database they are given.
- Do not commit `.env`.
- Do not add a default administrator password.

## Mobile cutover

Change the caregiver app base URL only after the compatibility checklist in `docs/COMPATIBILITY.md` passes against this deployment. The app must send `cancellationReason` on cancel. It does not need to send `X-Timezone`. It needs `appointmentId` on check-in only when one caregiver has two scheduled appointments for the same client on the same date.
