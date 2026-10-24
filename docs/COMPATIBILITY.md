# Endpoint compatibility report

Checked against the caregiver contract in `backend_rebuild_spec` on 2026-10-19. Automated coverage is `npm test` (auth, clients, appointments, check-in, checklist, daily completion, timezone, closed sets, and admin-note exclusion). The Flutter app was not modified and was not pointed at this server.

## Implemented caregiver endpoints

| Method and path | Result | Notes |
|---|---|---|
| `POST /api/v1/auth/login` | Compatible | No bearer token. `expiresIn` is `86400`. `permissions` is `[]`. Access token is a JWT. Wrong password is 401. Any role other than `CAREGIVER` is 403 and issues no tokens. |
| `POST /api/v1/auth/refresh` | Compatible | No bearer token required. Returns a new JWT and a new opaque refresh token. The previous token then returns 401. Reuse also revokes that login's remaining refresh tokens. |
| `GET /api/v1/appointments/caregiver/{caregiverId}` | Compatible | `data` is an array. No pagination object. Full client embed, no diagnoses. Another caregiver id is 404. Empty list is `[]`. |
| `GET /api/v1/appointments/{id}` | Compatible | Same appointment object. Unknown id and another caregiver's id are 404. |
| `PUT /api/v1/appointments/{id}` | Compatible with the decided rule, incompatible with the current app body | Body without `cancellationReason` is 422 and does not cancel. Body with `cancelled` and a non-empty reason returns the full appointment. Any other `appointmentStatus` is 422. `status` stays `active`. |
| `POST /api/v1/appointments/{id}/daily-completion/toggle` | Compatible | `data` is `{ appointmentId, date, completed: true }`. A repeat stays completed. One day of a multi-day visit leaves `appointmentStatus` as `scheduled`. The only day of a single-day visit sets it to `completed`. |
| `GET /api/v1/clients/caregiver/{caregiverId}` | Compatible | Outer `data` is `{ data, meta }`. `page`, `pageSize`, `status`, and `search` are honored. Page size 10 of 11 clients sets `hasNextPage`. Empty search is `data: []` and `total: 0`. |
| `GET /api/v1/clients/{id}` | Compatible | Nested address, diagnoses, languages, contacts, hazards, care plans, and appointment summaries. `doctor_visit` includes doctor fields. Ordinary visits omit them. Another caregiver's client is 404. |
| `POST /api/v1/care-plans/{carePlanId}/check-in` | Compatible when one visit matches | Accepts `timestamp`, `location`, and `date` with no `appointmentId`. Sets `checkInTime` and leaves `dailyVisitStatus` as `pending`. Zero matches and more than one match are 422 and write nothing. A supplied `appointmentId` is used after the ownership checks. Another caregiver's ids are 404. |
| `POST /api/v1/care-plans/{carePlanId}/completions/toggle` | Compatible | `data.completed` is a boolean. The second call returns the opposite boolean. The following GET shows the same `completedToday` for the current day. A toggle before check-in is 422. |

No caregiver route was moved under `/api/v2` or `/mobile`.

## Checklist from the specification

Headers and auth

- Login does not require Authorization, and the body is `email`, `password`, and `role: "CAREGIVER"`.
- Login `expiresIn` is the number `86400`, `accessToken` is a JWT, and `permissions` is `[]`.
- Authenticated calls accept `Authorization: Bearer <accessToken>`.
- Refresh body is `{ "refreshToken" }` and does not need a bearer token.
- Refresh returns a new non-empty opaque token and `expiresIn` `86400`. The previous token then returns 401.
- A bad or expired access token returns 401 JSON.
- A bad refresh token returns 401.
- Cookies are not set.
- A missing or invalid `X-Timezone` uses `America/Vancouver`. `America/Vancouver` and `Pacific/Auckland` are applied as sent. Covered at `2026-10-20T06:30:00.000Z`, which is still 19 October in Vancouver and already 20 October in Auckland.

Envelope

- 2xx bodies are JSON objects. The payload is under `data`.
- 400, 401, 403, 404, and 422 are JSON objects. `message` is a string. `errors` values are arrays of strings.
- Failed login is HTTP 401, not HTTP 200.
- Ids are strings. There is no `_id`. Bools are JSON booleans. `expiresIn`, `duration`, and `meta` values are JSON numbers.
- Appointment list `data` is an array. A test fails if that payload is treated as a page object.
- Clients list `data` is `{ data, meta }`. A test fails if it is a bare array.
- Nullable fields are JSON null, not the string `"null"`.
- `gender`, `proficiency`, `severity`, hazard `type`, and `appointmentType` use the closed lists. Caregiver JSON for `other` has no admin-note field. Diagnosis `notes` is still returned; that field is the note the app already parses.

Workflows

- Today's pending visit returns `activeToday: true`, `completedToday: false`, `dailyVisitStatus: "pending"`.
- A future day returns `activeToday: false` and still includes `locationGateCode`.
- Check-in with one matching visit returns the full appointment and the following GET keeps `pending`.
- Two matching visits return 422 and do not insert a check-in.
- After daily completion, GET shows `completedToday: true`, `dailyVisitStatus: "completed"`, and `activeToday: false` for that timezone's today.
- The next calendar day returns `completedToday: false` and `dailyVisitStatus: "completed"`.
- A repeated daily-completion call does not clear the day.
- After a valid cancel, GET shows `cancelled`, the stored reason, and `dailyVisitStatus: "cancelled"`.

## Known client mismatch

`PUT /appointments/{id}` with only `{ "appointmentStatus": "cancelled" }` returns 422. That is the body in the current commented Flutter call. The server does not substitute a reason. Cancel works after the app sends the reason the dialog already collected.

Check-in without `appointmentId` works for one matching visit and returns 422 when two scheduled active visits overlap that date.

## Not part of this report

`/auth/logout`, `/auth/forgot-password`, and `/auth/reset-password` are not implemented. See `docs/ASSUMPTIONS.md`. Admin portal CRUD is not implemented. `POST /api/v1/admin/auth/login` is implemented and is not a caregiver route.

## Sign-off

| Check | Result | Date |
|---|---|---|
| Contract tests | Passed locally: 30 tests, typecheck clean | 2026-10-19 |
| Seed caregiver manual pass | Not run against a device | |
| Second caregiver isolation | Covered by automated 404 tests | 2026-10-19 |
| Ready for admin portal CRUD | Caregiver API is in place. Admin CRUD routes are still unimplemented | 2026-10-19 |
