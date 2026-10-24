# 08 — Implementation Plan

Build the backend first, prove it against the caregiver contract, then build the admin portal. Do this in a new repository. Do not add server code to the Flutter app.

## Dependencies between phases

```text
Phase 0  Read the contract
   ↓
Phase 1  Project skeleton, envelope, errors, auth
   ↓
Phase 2  Database and seed
   ↓
Phase 3  Read APIs (appointments, clients)
   ↓
Phase 4  Visit writes (check-in, toggle, complete, cancel)
   ↓
Phase 5  Contract tests from file 09 and fixtures in file 11
   ↓
Phase 6  Point Flutter at the server (base URL + uncomment)
   ↓
Phase 7  Admin API and admin portal
   ↓
Phase 8  Deployment
```

Admin work must not start by changing caregiver JSON. It consumes the same database through new routes.

## Phase 0 — Contract intake

**Exit:** the implementer can name all 13 paths and the clients-list double nest without opening Flutter.

Read, in order: `02_api_inventory.md`, `03_data_models.md`, `04_authentication_and_permissions.md`, `11_api_contract_fixtures.md`.

## Phase 1 — API skeleton and auth

**Suggested stack:** any server that can serve JSON. The contract does not require a language. Keep camelCase JSON regardless of database column style.

| Task | Acceptance |
|---|---|
| `POST /api/v1/auth/login` | Body `email`, `password`, `role: "CAREGIVER"`. 200 envelope matches the login fixture. `accessToken` is a JWT. `expiresIn` is `86400`. `permissions` is `[]`. Wrong password is 401. Any other role is rejected and no tokens are issued |
| `POST /api/v1/auth/refresh` | No bearer header. Returns a new JWT and a new opaque refresh token. The previous refresh token then returns 401. Refresh lifetime is 30 days |
| Bearer middleware | Missing or bad access token on caregiver routes is 401 |
| Error helper | 400, 403, 404, 422, 500 use `message`, optional `code`, optional `errors` |
| Scope helper | A caregiver id, client, appointment, or care plan outside the token subject returns 404 |
| Timezone helper | Valid `X-Timezone` wins. Missing or invalid uses `America/Vancouver` |

The app does not enforce `expiresIn`. It refreshes after 401.

Do not implement caregiver logout, forgot-password, or reset-password in this phase. An admin sets caregiver passwords later. Do not block reads on those unused paths.

## Phase 2 — Database and seed

Implement the proposal in `05_database_schema.md`. Label migrations as proposed schema, not a restored production dump.

**Seed (sanitized, no real people):**

| Record | Purpose |
|---|---|
| Caregiver user `role=CAREGIVER`, known password of at least 6 characters | Login |
| Two active assigned clients with address, one language, one contact, one diagnosis, one hazard, one service requirement | List and detail |
| One care plan per client with one task, one medication, one diet, one hygiene | Checklist |
| Appointment today, `appointmentStatus=scheduled`, `status=active`, daily visit `pending` / `activeToday=true` / `completedToday=false` | Check-in path |
| Appointment tomorrow | Date lock |
| Appointment yesterday with `appointmentStatus=completed` | Completed tab |
| Cancelled appointment | Cancelled tab |
| 11th active client | Proves `hasNextPage` at page size 10 |

Store only a password hash in the seed command's output notes, and keep the plaintext out of git if the repository will be shared. A local-only dev password is acceptable in a private seed script.

## Phase 3 — Read endpoints

| Endpoint | Acceptance |
|---|---|
| `GET /appointments/caregiver/{id}` | `data` is an array of `AppointmentModel` objects. No `meta` wrapper. Includes flat location, `completedToday`, `activeToday`, `dailyVisitStatus`, embedded client and caregiver |
| `GET /appointments/{id}` | One object. Embedded client includes care plans and service requirements. Diagnoses may be omitted |
| `GET /clients/caregiver/{id}` | Outer `data` is `{ data: [...], meta: {...} }`. Honors `page`, `pageSize`, `status=active`, optional `search` |
| `GET /clients/{id}` | Nested `address`. Includes diagnoses, care plans, and `appointments` summaries. `doctor_visit` rows include doctor fields |

String ids. Bools are bools. Dates are `YYYY-MM-DD`. Clock times are `HH:mm`.

Another caregiver's id returns 404, whether or not the row exists. Unknown ids also return 404. Compute `completedToday` and `activeToday` in `America/Vancouver` when `X-Timezone` is absent. Appointment list and detail both embed the full client, including care plans. Diagnoses stay on the client endpoint. Always return `locationGateCode`. Appointment `status` is `active` or `inactive`. A past completed day returns `completedToday: false` and `dailyVisitStatus: "completed"`.

## Phase 4 — Visit writes

| Endpoint | Acceptance |
|---|---|
| Check-in | Accept the current body (`timestamp`, `location`, `date`) when exactly one scheduled active appointment for that caregiver and client covers `date`. Response `data` is the full appointment. Following GET shows non-empty `checkInTime`, `dailyVisitStatus` still `pending`, `activeToday` true, `completedToday` false. Two matches return 422 and write nothing. A supplied `appointmentId` is used after the same ownership checks. The current app does not send it |
| Item toggle | `data.completed` is a bool. Following GET shows that item's `completedToday` equal to it. Second call flips it |
| Daily completion | 2xx with `{ appointmentId, date, completed: true }`. Following GET shows `completedToday` true for that timezone's today, `dailyVisitStatus` `completed`, `activeToday` false. `appointmentStatus` stays `scheduled` until every day is done or an admin completes the appointment. A second call stays completed |
| Cancel PUT | Body without `cancellationReason` is 422. Body `{ "appointmentStatus": "cancelled", "cancellationReason": "<text>" }` returns the full appointment. Any other `appointmentStatus` is rejected |

Enforce assignment checks on every write.

## Phase 5 — Contract tests

Automate the checklist in `09_api_compatibility_checklist.md`.

Minimum suite:

1. Login fixture equals the parser's required keys and types.
2. Refresh without Authorization succeeds.
3. Appointment list is a JSON array under `data`.
4. Clients list has two levels of `data` plus `meta` ints and bools.
5. A numeric `id` test is expected to be absent; ids are strings.
6. Toggle returns `{ completed: <bool> }` inside `data`.
7. 401 login body is JSON with `message`.
8. 422 body includes `errors` as an object when fields fail.

Run the suite in CI before any Flutter change.

## Phase 6 — Flutter integration

Only after Phase 5 is green.

| Change | Why |
|---|---|
| `ApiConstants.baseUrl` | Required environment change |
| Uncomment every `SERVER_DOWN` block and delete the `DemoData` stand-in on that line | Otherwise the phone never calls the new server. This does not change the bodies |
| Add `cancellationReason` to the cancel PUT body | Required. The dialog already collects it and the commented body drops it. The server cannot recover it |
| Do not add `X-Timezone` for this release | The server uses `America/Vancouver` when the header is absent |
| Add `appointmentId` to check-in only if overlapping visits must succeed | The unique-match fallback covers one visit. Two visits return 422 until this field is sent |

Do not rename fields, paginate appointments, or merge `status` with `appointmentStatus`.

Manual pass on a device or simulator:

1. Login with the seed caregiver.
2. Dashboard shows today's visit and the future visit. Gate code hidden on the future visit.
3. Clients search finds a seeded last name. Scroll loads page 2 if 11 clients exist.
4. Client detail shows diagnosis, care plan, and a doctor visit popup.
5. Today's appointment: check-in (allow location). The refetched visit still has `dailyVisitStatus: "pending"` and a non-empty `checkInTime`. Toggle one item off and on. Mark complete for today. Repeat the complete call and confirm the day stays completed.
6. A second appointment: cancel, after the Flutter body includes the reason. It appears on the Cancelled tab. The reason is visible. A request without the reason shows the 422 message and does not cancel.
7. Force a 401 (revoke the access token only) and confirm refresh keeps the session.
8. Revoke the refresh token and confirm the next call returns to login.

## Phase 7 — Admin portal

Start a third project. Implement the modules in `07_admin_portal_specification.md` in this order:

1. Admin login and caregiver CRUD, including set-password.
2. Client CRUD, address, and many-to-many caregiver assignment.
3. Clinical child records, using the closed lists, and care plans with the four item types. `other` stores an admin-only note.
4. Appointment create/edit, including copy-from-client location and doctor fields.
5. Visit history for check-ins, checklist toggles, daily completions, and cancellations.
6. Audit log of admin changes.
7. Dashboard counts. No exported reports.

**Acceptance:** a record created in the portal appears in the caregiver app after refresh, with the same ids and spellings. `other` displays as `Other` and the note does not appear. A caregiver token cannot call admin routes.

## Phase 8 — Deployment

| Piece | Requirement |
|---|---|
| API | TLS, private database, health check, structured logs without tokens or passwords |
| CORS | Allow the admin portal origin. The Flutter app does not need browser CORS |
| Secrets | Password hashing salt, JWT or token pepper, database URL. Never commit them and never paste them into this spec folder |
| Backups | Database backups before the first real caregiver data load |
| Mobile | Release build with the production base URL only after Phase 6 passes against that environment |

## Suggested milestone order for a new Cursor session

Paste this instruction:

1. Create the API project.
2. Implement Phase 1 and Phase 2.
3. Implement Phase 3 and Phase 4 using `backend_rebuild_spec` as the only contract.
4. Add contract tests from `09` and `11`.
5. Stop before editing the Flutter repo.

Then a second session builds the admin portal from `07`.

## Out of scope for the first milestone

- Forgot-password and OTP
- Push notifications
- File upload
- Rewriting the Flutter UI
- Matching an unknown production schema column-for-column
- Exported reports. Visit history and the audit log are in scope. Charts and file exports are not
