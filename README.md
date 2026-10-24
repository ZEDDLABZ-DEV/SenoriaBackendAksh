# Senoria Caregiver API

Independent API for the Senoria caregiver app. It implements the caregiver contract in `backend_rebuild_spec` and does not contain Flutter code. The admin web portal is a separate frontend; this service only exposes the caregiver contract plus administrator login and a one-time administrator bootstrap.

The base path is `/api/v1`. Successful responses use `{ message, data }`. Errors use `{ message, code?, errors? }`.

## Requirements

- Node.js 20 or newer
- PostgreSQL 16

## Local setup

```bash
npm install
cp .env.example .env
```

Generate `JWT_SECRET` and `REFRESH_TOKEN_PEPPER` with `openssl rand -base64 48`. Each value must be at least 32 characters. Do not commit `.env`.

### Database

`npm run db:local` creates a project-local PostgreSQL cluster in `.local/pgdata` and listens on `127.0.0.1:54329`. It does not use or repair any other PostgreSQL data directory.

```bash
npm run db:local
```

Put these URLs in `.env`:

```text
DATABASE_URL=postgresql://senoria@127.0.0.1:54329/senoria
TEST_DATABASE_URL=postgresql://senoria@127.0.0.1:54329/senoria_test
```

To use an existing PostgreSQL server instead, create two empty databases and set the same variables. The test database name must contain `test`. The test suite truncates that database and refuses any URL that does not look like a test database.

Apply migrations. This only adds the pending schema. It does not drop data.

```bash
npm run db:migrate
```

Do not run `prisma migrate reset` against a database that holds real caregiver data.

### Run

```bash
npm run dev
```

`GET /health` returns `{ "status": "ok", "database": "up" }` when PostgreSQL is reachable.

### Development caregiver

`npm run db:seed` inserts fictional sample data for local login. Set these in `.env` first. The password is read at runtime and is not written into the repository or printed by the command.

```text
SEED_CAREGIVER_EMAIL=alex.rivera@example.com
SEED_CAREGIVER_PASSWORD=choose-a-local-password
SEED_CAREGIVER_FIRST_NAME=Alex
SEED_CAREGIVER_LAST_NAME=Rivera
SEED_CAREGIVER_PHONE=(604) 555-0148
```

The seed refuses to run when `NODE_ENV=production`. Running it again updates that caregiver's password and does not delete existing clients.

Sample schedule dates use the current calendar day in `America/Vancouver`: a visit today, one tomorrow, one completed yesterday, and one cancelled visit, plus 11 active clients.

### Initial administrator

Caregiver accounts do not get a forgot-password flow. An administrator sets caregiver passwords. Create the first administrator with:

```bash
npm run admin:bootstrap
```

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), `ADMIN_FIRST_NAME`, and `ADMIN_LAST_NAME` in the environment for that command. The command:

- hashes the password with Argon2id
- refuses to run if any `ADMIN` user already exists
- does not reset an existing password
- prints the new id and email, and does not print the password

There is no default administrator and no password in source control. Administrator login is `POST /api/v1/admin/auth/login`. A caregiver token cannot call `/api/v1/admin`, and an administrator token cannot call the caregiver routes.

The rest of the admin portal API (caregiver CRUD, clients, appointments, visit history, audit reads) is not implemented yet. The tables are in the migration so those routes can be added without changing the caregiver JSON.

## Tests

```bash
npm test
npm run typecheck
```

Tests apply migrations to `TEST_DATABASE_URL` and truncate only that database.

## Documentation

| Document | Contents |
|---|---|
| [docs/API.md](docs/API.md) | Endpoint contract |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | Endpoint-by-endpoint compatibility report |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Assumptions and unimplemented endpoints |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment |

## Cancel compatibility

The current caregiver app sends `{ "appointmentStatus": "cancelled" }` and does not send `cancellationReason`. This API returns **422** for that body and does not invent a reason. Cancel succeeds only when the body is `{ "appointmentStatus": "cancelled", "cancellationReason": "<non-empty text>" }`. The Flutter app has to add the reason it already collects before cancel will succeed.
