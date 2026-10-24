# 09 — API Compatibility Checklist

Use this before changing the Flutter app, and again after the base URL points at the new server. A failure here means the server must change. Do not "fix" the Flutter parser to accept a cleaner payload.

Mark each box only when a real response has been checked. Fixtures in `11_api_contract_fixtures.md` are the expected shapes.

## Endpoint parity

- [ ] `POST /api/v1/auth/login` exists and does not require Authorization.
- [ ] `POST /api/v1/auth/refresh` exists and does not require Authorization.
- [ ] `GET /api/v1/appointments/caregiver/{caregiverId}` exists.
- [ ] `GET /api/v1/appointments/{id}` exists.
- [ ] `PUT /api/v1/appointments/{id}` exists.
- [ ] `POST /api/v1/appointments/{id}/daily-completion/toggle` exists.
- [ ] `GET /api/v1/clients/caregiver/{caregiverId}` exists.
- [ ] `GET /api/v1/clients/{id}` exists.
- [ ] `POST /api/v1/care-plans/{carePlanId}/check-in` exists.
- [ ] `POST /api/v1/care-plans/{carePlanId}/completions/toggle` exists.
- [ ] No caregiver call was moved under a new prefix such as `/api/v2` or `/mobile`.
- [ ] Logout, forgot-password, and reset-password, if implemented, are additive. The app does not call them today.

## Headers and auth

- [ ] Login succeeds with `Content-Type: application/json` and `Accept: application/json` and no Authorization header.
- [ ] Login body is exactly `email`, `password`, and `role: "CAREGIVER"`.
- [ ] Login `expiresIn` is the number `86400`, and `accessToken` is a JWT.
- [ ] Login `permissions` is `[]`.
- [ ] Authenticated calls accept `Authorization: Bearer <accessToken>`.
- [ ] Refresh body is exactly `{ "refreshToken": "<token>" }` with no bearer token.
- [ ] Refresh returns a new non-empty opaque `refreshToken` and `expiresIn` `86400`.
- [ ] The previous refresh token then returns HTTP 401.
- [ ] A bad access token returns HTTP 401 and a JSON object, so the client can refresh once and retry.
- [ ] A bad refresh token returns HTTP 401.
- [ ] Cookies are not required.
- [ ] A request with no `X-Timezone` header still succeeds and uses `America/Vancouver` for `completedToday` and `activeToday`.
- [ ] A request with `X-Timezone: America/Vancouver` uses that zone. An invalid value uses the same fallback.

## Envelope and status codes

- [ ] Every 2xx body is a JSON object.
- [ ] The useful payload is under `data`, not at the root.
- [ ] The client can ignore `success` if it is present. HTTP status alone is enough.
- [ ] 400, 401, 403, 404, and 422 return JSON objects.
- [ ] `message` is a string when present.
- [ ] `errors`, when present, is an object whose values are strings or arrays of strings.
- [ ] 401 login uses HTTP 401, not HTTP 200.

## JSON contract parity

- [ ] Every id is a JSON string.
- [ ] There is no reliance on `_id`.
- [ ] `expiresIn`, `duration`, and all `meta` numbers are JSON numbers.
- [ ] Bool fields are JSON `true` / `false`, not `"true"` or `1`.
- [ ] Login `data` contains `user`, `accessToken`, `refreshToken`, and `expiresIn`.
- [ ] `user` contains `id`, `email`, `firstName`, `lastName`, `role`, and `permissions` (array). `avatar` is a string or null.
- [ ] `user.role` is `CAREGIVER` for caregiver accounts.
- [ ] Appointment list `data` is an array.
- [ ] Each appointment includes both `appointmentStatus` and `status`.
- [ ] Each appointment includes `completedToday`, `activeToday`, and `dailyVisitStatus`.
- [ ] Location fields are flat: `locationStreet`, `locationCity`, `locationState`, `locationZipCode`, `locationGateCode`, `locationNavigation`.
- [ ] `startTime` and `endTime` are `HH:mm` strings.
- [ ] `scheduledDate` and `endDate` parse with `DateTime.tryParse` (`YYYY-MM-DD` is valid).
- [ ] Embedded `client.carePlans[]` include `tasks`, `medications`, `dietInstructions`, and `hygieneInstructions`.
- [ ] Each checklist item includes string `id` and bool `completedToday`.
- [ ] Medication items use `medicationName` (or `name`) and `schedule` (or `frequency`).
- [ ] Clients list HTTP body is `{ message, data: { data: [ ... ], meta: { ... } } }`.
- [ ] `meta` includes `total`, `page`, `pageSize`, `totalPages`, `hasNextPage`, `hasPreviousPage`.
- [ ] Client `address` is nested with `street`, `apartment`, `city`, `state`, `zipCode`, `country`, `gateAccessCode`, `navigationInstructions`.
- [ ] Client detail includes `diagnoses`, `languages`, `emergencyContacts`, `hazards`, `carePlans`, and `appointments`.
- [ ] A `doctor_visit` summary includes `doctorName`, `doctorSpecialty`, `doctorPhone`, and `clinicName`.
- [ ] Toggle `data.completed` is a bool, and a second call returns the opposite bool.
- [ ] Daily completion `data` is `{ appointmentId, date, completed: true }`, and a second call for that date stays `completed: true`.
- [ ] Cancel PUT with only `{ "appointmentStatus": "cancelled" }` returns 422. This is the body the current app sends, so cancel is incompatible until Flutter adds the reason.
- [ ] Cancel PUT with `appointmentStatus: "cancelled"` and a non-empty `cancellationReason` returns 2xx.
- [ ] Cancel `data` is the full appointment, including `id`, `appointmentStatus: "cancelled"`, and `cancellationReason`.
- [ ] A caregiver PUT with any other `appointmentStatus` is rejected.

## Pagination, search, uploads

- [ ] Clients honor `page`, `pageSize`, `status=active`, and optional `search`.
- [ ] `pageSize=10` returns at most 10 rows and a correct `hasNextPage`.
- [ ] Empty search results are `data: []` and `total: 0`, not an error.
- [ ] Appointment list is not paginated.
- [ ] No endpoint requires multipart form data.

## Workflow parity

- [ ] Today's pending visit returns `activeToday: true`, `completedToday: false`, `dailyVisitStatus: "pending"`.
- [ ] A future scheduled day returns `activeToday: false` so the app locks the gate code and checklist. The gate code is still present in JSON.
- [ ] Check-in with `timestamp`, `location`, and `date`, and no `appointmentId`, succeeds when exactly one scheduled active appointment covers that date.
- [ ] That check-in response `data` is the full appointment. The following GET shows a non-empty `checkInTime`, `dailyVisitStatus: "pending"`, `activeToday: true`, and `completedToday: false`.
- [ ] The same check-in returns 422 when two scheduled active appointments for that caregiver and client cover the date, and it does not write a check-in.
- [ ] After each item is completed for that date, GET shows `completedToday: true` on those items. A second toggle shows `false`.
- [ ] After daily completion, GET shows `completedToday: true` on the appointment, `dailyVisitStatus: "completed"`, and `activeToday: false`. `appointmentStatus` stays `scheduled` when other days in the range are still open.
- [ ] A repeated daily-completion call does not clear `completedToday`.
- [ ] After a valid cancel, GET shows `appointmentStatus` of `cancelled`, the stored `cancellationReason`, and `dailyVisitStatus` of `cancelled`.
- [ ] A caregiver request for another caregiver's client, appointment, or care plan returns 404.
- [ ] `gender`, `proficiency`, `severity`, hazard `type`, and `appointmentType` use the closed lists in `03_data_models.md`. Caregiver JSON for `other` has no admin-note field.

## Error and empty cases

- [ ] Unknown appointment id returns 404 with `message`.
- [ ] Unknown client id returns 404 with `message`.
- [ ] Validation failure returns 422 with `message` and `errors`.
- [ ] Empty appointment list returns `data: []` and HTTP 200.
- [ ] Nullable fields (`email`, `avatar`, `profileImage`, `checkInTime`, `checkOutTime`, `cancellationReason`, `carePlanId`, `icdCode`) are JSON null or omitted, not the string `"null"`.

## Automated regression

- [ ] Contract tests load `11_api_contract_fixtures.md` examples, or JSON files generated from them, and assert status, types, and required keys.
- [ ] A test fails if appointment `data` is an object with `meta`.
- [ ] A test fails if clients `data` is a bare array.
- [ ] A test fails if any id in the seed responses is a number.
- [ ] CI runs these tests on every API change.

## Flutter smoke test (after the server is green)

- [ ] `ApiConstants.baseUrl` changed, the existing `SERVER_DOWN` calls are uncommented, and cancel sends `cancellationReason`.
- [ ] `X-Timezone` was not added. Check-in `appointmentId` was added only if the overlapping-visit case is in this test.
- [ ] Login, dashboard, client paging, client detail, check-in, item toggle, daily complete, and cancel work against the new host.
- [ ] After check-in, the visit chip still shows Pending and the action bar is visible.
- [ ] Cancel without a reason shows the server message and leaves the appointment scheduled.
- [ ] Session refresh works after a single 401.
- [ ] Expired refresh returns the user to login.

## Sign-off

| Check | Result | Date |
|---|---|---|
| Contract tests | | |
| Seed caregiver manual pass | | |
| Second caregiver isolation | | |
| Ready for admin portal work | | |
