# 10 — Open Questions, Assumptions, and Confirmed Facts

## Decisions recorded on 2026-10-19

All A1–A15 and U1–U20 rows below are resolved. This is the short list.

| Topic | Decision |
|---|---|
| Caregiver scope | Own clients, appointments, and those care plans only. Other ids return 404 |
| Today | `X-Timezone` is the IANA header when a client sends it. The current app does not. Fallback `America/Vancouver` |
| Daily completion | Idempotent. Repeating the request does not undo it. Response is a small completion record |
| Checklist items | Real toggle between completed and incomplete |
| Check-in effect | Sets `checkInTime` only. `dailyVisitStatus` stays `pending`. Response `data` is the full appointment |
| Check-in link | Identify the visit by `appointmentId` when the body has it. The current app does not send it. Unique-match fallback is below |
| Cancel | Requires `cancellationReason`. The current app does not send it. Response is the full appointment. PUT is cancel only |
| Assignments | Many caregivers per client |
| Admin | Separate admin app only. Role `ADMIN`. Prefix `/api/v1/admin`. Admin sets caregiver passwords |
| Allergies | Diagnosis rows |
| Service requirement times | Calendar dates `YYYY-MM-DD` |
| Ids | String UUIDs |
| Tokens | Access token is a JWT lasting 24 hours (`expiresIn` 86400). Refresh token is opaque, lasts 30 days, and rotates on every refresh |
| Gate code | Always returned. The app hides it until the visit day |
| Appointment client embed | Full client on list and detail. Diagnoses stay on the client endpoint |
| Permissions | Always `[]` |
| `completedToday` | True only for the current day in `X-Timezone`, or in `America/Vancouver` when the header is absent |
| Database | Proposed schema is the new database. No soft delete. `active` / `inactive` |
| Appointment `status` | `active` or `inactive` only. Not the visit state |
| Closed lists | Fixed values plus `other`, with an admin-only note |
| Multi-day visits | `appointmentStatus` stays `scheduled` until every day is done, or an admin completes the whole appointment |
| Admin history | Audit log plus visit history. No exported reports |

The current caregiver app cannot stay on a base-URL-only change. The comparison below is from the Flutter source, not from an assumption that those fields are already sent.

## Flutter request comparison (inspected 2026-10-19)

Source: `senoria_seniors_caretaker`. No Flutter files were modified.

### `X-Timezone` is not sent

`ApiConstants.defaultHeaders` (`api_constants.dart` 19–22) is `Content-Type` and `Accept`. `ApiClient._buildHeaders` (`api_client.dart` 272–280) adds `Authorization` only. Refresh (`api_client.dart` 196–199) uses the same two headers.

**Safe server-side solution: yes.** A missing or invalid `X-Timezone` means `America/Vancouver`. Every request from this app takes that path. Do not derive an IANA zone from the UTC `timestamp` plus `date`. Several zones share an offset, and daylight-saving boundaries are ambiguous.

**Limit:** `DateFormatter.isoDate` and `isFutureDate` use the device's local calendar. A phone that is not set to `America/Vancouver` can post a `date` that is not Vancouver's today, while `completedToday` and `activeToday` are computed in Vancouver. That does not require a client change for caregivers whose device today matches Vancouver. Sending the header later is valid. It is not required for this app.

### `cancellationReason` is not sent

`cancelAppointment(String reason)` receives the dialog text. The commented body does not include it (`appointment_detail_controller.dart` 200–203):

```dart
body: <String, dynamic>{'appointmentStatus': 'cancelled'},
```

`DemoData.cancelAppointment` stores the reason only in memory.

**Safe server-side solution: no.** The typed reason is not in the body, the query, or any header. A placeholder would not be the caregiver's reason. The server requires a non-empty `cancellationReason` and returns 422 for this body.

**Unavoidable client change:** put the reason already held by `cancelAppointment` into that JSON object.

### Check-in `appointmentId` is not sent

The commented body is `timestamp`, `location`, and `date` (`appointment_detail_controller.dart` 129–136). The path identifies the care plan. `_appointmentId` stays in the controller.

**Safe server-side solution: yes when one visit matches, no when more than one matches.**

Bind a body that omits `appointmentId` only when all of these are true for exactly one appointment:

- the care plan belongs to the appointment's client
- `caregiverId` is the token subject
- `date` is inside `scheduledDate` through `endDate`
- `appointmentStatus` is `scheduled`
- `status` is `active`

Zero matches: 404 when the care plan is not this caregiver's, otherwise 422. More than one match: 422, and do not pick a row. Do not filter on `appointment.carePlanId`. Check-in is allowed for every care plan on that client.

When the body includes `appointmentId`, use that id after the same ownership checks. The current app does not send it. Rejecting every body that omits it would make check-in fail. Accepting the unique match keeps the current body working for one visit.

**Client change:** required only when one caregiver has two overlapping scheduled appointments for the same client. Until the app sends `appointmentId`, those check-ins return 422.

### What must change in the app

| Change | Required? |
|---|---|
| `ApiConstants.baseUrl` | Yes, or the app still targets the old host |
| Uncomment each `SERVER_DOWN` call and stop using `DemoData` | Yes, or a new base URL still serves demo data |
| Add `cancellationReason` to the cancel body | Yes. No server substitute |
| Send `appointmentId` on check-in | Only for overlapping visits |
| Send `X-Timezone` | No |

## Confirmed facts

These are directly visible in this repository.

1. The HTTP client is `ApiClient` (`package:http`). There is no Dio, Retrofit, or second client. Refresh uses a direct `http.post`.
2. The base URL is `https://api.senoriaseniors.com` and the prefix is `/api/v1`.
3. Success is HTTP 2xx. The parsed value is `json['data']`. A `success` flag is not read.
4. Authenticated calls send `Authorization: Bearer <accessToken>` when a token exists.
5. Login sends `email`, `password`, and `role: "CAREGIVER"`, without a bearer token.
6. Login `data` is `user`, `accessToken`, `refreshToken`, `expiresIn`.
7. The app stores tokens and the user in GetStorage and ignores `expiresIn` after parsing.
8. Refresh sends `{ "refreshToken" }` without Authorization, once, then retries the original call once.
9. Logout is local. The path `/auth/logout` is never called. Its HTTP method is not in the source. Same for `/auth/forgot-password` and `/auth/reset-password`.
10. Forgot password is a button with an empty `onPressed`. Reset password is never called.
11. Thirteen endpoint paths are declared. Ten have call sites: login, refresh, both appointment reads, appointment cancel, daily completion, both client reads, care-plan check-in, and care-plan item toggle. Logout, forgot-password, and reset-password are constants only. See `02_api_inventory.md`.
12. Almost every wired call is commented with `SERVER_DOWN` and replaced by `DemoData`.
13. Appointment list `data` is a JSON array. Clients list `data` is `{ data, meta }`.
14. Ids are strings named `id`.
15. Appointments have both `status` and `appointmentStatus`, plus `dailyVisitStatus`, `completedToday`, and `activeToday`.
16. Appointment location fields are flat. Client address is nested, with flat fallbacks.
17. Checklist `itemType` is `task`, `medication`, `diet`, or `hygiene`.
18. Check-in sends UTC `timestamp`, `location.latitude`, `location.longitude`, and local `date`.
19. Daily completion sends `{ "date": "YYYY-MM-DD" }` and then refetches. The response body is not parsed.
20. Cancel's commented body is `{ "appointmentStatus": "cancelled" }` only.
21. The cancel dialog collects a reason and the commented request does not send it.
22. The app has no registration, upload, payment, or push-notification code.
23. `lib/shared/models/` is unused by the networking layer.
24. No `.env` and no live credentials were found.
25. Client list query is `page`, `pageSize` (always 10), `status` (always `active`), and optional `search`.
26. Appointment search and status tabs are local.
27. Only `CAREGIVER` may remain signed in. `permissions` is parsed and unused.
28. Diagnoses are not parsed on the appointment embed. The appointment screen shows a static unavailable diagnoses block.
29. Service requirements are parsed on the appointment embed, not on `ClientModel`.
30. Care-plan detail from the client screen does not call the network.

## Assumptions and recommendations

| # | Assumption | Why | If wrong |
|---|---|---|---|
| A1 | **RESOLVED:** A caregiver may access only their own clients, appointments, and those clients' care plans. Another caregiver's id returns **404** (hidden, not 403). Decided 2026-10-19. | Lists are caregiver-scoped | 403 would also parse, but the product choice is 404 |
| A2 | **RESOLVED:** "Today" uses `X-Timezone` when that header is a valid IANA name. This app does not send it. A missing or invalid header uses `America/Vancouver` for `completedToday` and `activeToday`. Decided 2026-10-19. Compared with `api_constants.dart` and `api_client.dart` the same day. | Read URLs have no date query | Inferring a zone from `timestamp` and `date` is not safe |
| A3 | **RESOLVED:** After a day is completed, the complete button stays hidden. The current app already hides the whole action bar when `completedToday` is true. The server must set `completedToday: true` on the refetch. A second call for that appointment and date stays completed. It does not undo the visit. Decided 2026-10-19. | The button is not an undo control | A true toggle would bring the button back if the second call cleared `completedToday` |
| A4 | **RESOLVED:** Care-plan item completion is a real toggle. A second tap sets `completed` to false and the next read returns `completedToday: false`. Decided 2026-10-19. | The screen already flips the check and trusts `data.completed` | |
| A5 | **RESOLVED:** Check-in sets `checkInTime` only. `dailyVisitStatus` stays `pending`. `completedToday` stays false. `activeToday` must already be true or the action bar will not show. Decided 2026-10-19. | The complete/cancel bar appears because `checkInTime` is non-empty | After leaving the screen, the per-plan Check In button can appear again. Per-plan times are kept only in memory |
| A6 | **RESOLVED:** Cancel requires `cancellationReason`. The current commented body omits it. That request is 422 until Flutter adds the field. Decided 2026-10-19. | The reason is collected and then dropped | No server-side recovery exists |
| A7 | **RESOLVED by A6:** The server stores `cancellationReason` from the cancel PUT. It is required, not optional. Decided 2026-10-19. | The dialog already collects the text | |
| A8 | **RESOLVED:** Many caregivers can be assigned to one client. Use a many-to-many assignment. A caregiver still only receives clients assigned to them. Decided 2026-10-19. | | |
| A9 | **RESOLVED:** Admins sign in only in the separate admin app. They do not use the caregiver app. Caregiver `POST /auth/login` accepts `role: "CAREGIVER"` only. Admin role string is `ADMIN`. Admin routes use the `/api/v1/admin` prefix. Decided 2026-10-19. | | |
| A10 | **RESOLVED:** Allergies are diagnosis rows. There is no separate allergies list and no Flutter change. Decided 2026-10-19. | The app only parses `diagnoses` | |
| A11 | **RESOLVED:** `serviceRequirements.startTime` and `endTime` are calendar dates, serialized as `YYYY-MM-DD`. Decided 2026-10-19. | The parser uses `DateTime.tryParse` | |
| A12 | **RESOLVED:** Primary keys are string UUIDs. JSON `id` is that UUID string, never a number. Decided 2026-10-19. | | |
| A13 | **RESOLVED:** Refresh tokens last 30 days. Access tokens last 24 hours. `expiresIn` in the login and refresh payload is `86400`. The phone still refreshes only after a 401. Decided 2026-10-19. | | |
| A14 | **RESOLVED:** Always return `locationGateCode`, including on future visits. The app hides it until the visit day. Decided 2026-10-19. | | |
| A15 | **RESOLVED:** Appointment list and appointment detail both embed the full client, including care plans. Diagnoses stay off the appointment embed. The client profile endpoint still returns diagnoses. Decided 2026-10-19. | | |

## Unknowns

| # | Question | What the source shows | Needed before |
|---|---|---|---|
| U1 | **RESOLVED:** Access tokens are JWTs. The phone stores them as strings and does not read `exp`. Refresh tokens are opaque random strings, not JWTs. Decided 2026-10-19. | | |
| U2 | **RESOLVED:** Access token TTL is 24 hours (`expiresIn: 86400`). Refresh token TTL is 30 days. Decided 2026-10-19. | Demo `expiresIn` was 3600 and is discarded by the app | |
| U3 | **RESOLVED:** Every refresh returns a new refresh token and invalidates the previous one. Reusing the old refresh token returns 401. Decided 2026-10-19. | The app saves the new refresh token when it is non-empty | |
| U4 | **RESOLVED:** Caregiver v1 does not call logout, forgot-password, or reset-password. Logout stays local. An admin sets or resets the caregiver password in the admin app. Decided 2026-10-19. | Paths exist as unused constants | |
| U5 | **RESOLVED by U4:** No caregiver email, OTP, or reset-link flow. Decided 2026-10-19. | The Forgot password button is a no-op | |
| U6 | **RESOLVED:** `user.permissions` is always `[]`. The admin app uses the `ADMIN` role only. No named permission strings in v1. Decided 2026-10-19. | | |
| U7 | **RESOLVED:** Daily completion `data` is `{ "appointmentId", "date", "completed": true }`. The app ignores it and refetches the appointment. A repeat call stays completed (A3). Decided 2026-10-19. | | |
| U8 | **RESOLVED:** Check-in `data` is the full appointment object. The app ignores that body and refetches. The refetched appointment must have `checkInTime` set and `dailyVisitStatus` still `pending` (A5). Decided 2026-10-19. | | |
| U9 | **RESOLVED:** Cancel returns the full updated appointment in `data`, including `id`, `appointmentStatus: "cancelled"`, and `cancellationReason`. The app shows that object without a refetch. Decided 2026-10-19. | | |
| U10 | **RESOLVED by A2:** `activeToday` and `completedToday` use the `X-Timezone` header. Missing or invalid header falls back to `America/Vancouver`. Decided 2026-10-19. | | |
| U11 | **RESOLVED:** `completedToday` is true only for the current day in `X-Timezone`. This app does not send the header, so that day is `America/Vancouver`. A visit finished on an earlier day returns `completedToday: false` and `dailyVisitStatus: "completed"`. The card then does not say "Completed today". Decided 2026-10-19. | | |
| U12 | **RESOLVED:** Check-in is allowed for any care plan embedded on that client. `appointment.carePlanId` does not limit which plans can be checked in. No app change. Decided 2026-10-19. | | |
| U13 | **RESOLVED:** When `appointmentId` is present, attach the check-in to that appointment after confirming it belongs to this caregiver and the care plan belongs to that client. The current body omits it. Then attach only when exactly one scheduled active appointment matches. Otherwise 422. Decided 2026-10-19. | The current commented body has no appointment id | Guessing among two visits is not safe |
| U14 | **RESOLVED:** The proposed schema is the new database. Old table names are not copied. No soft delete. Use `active` and `inactive` status instead of deleting rows that must be kept. Decided 2026-10-19. | | |
| U15 | **RESOLVED by A8:** A client can have many caregivers. The caregiver API still returns only that caregiver's assignments. Decided 2026-10-19. | | |
| U16 | **RESOLVED:** Appointment `status` is only `active` or `inactive`. It is not the visit state. Visit state stays in `appointmentStatus`: `scheduled`, `completed`, or `cancelled`. Decided 2026-10-19. | | |
| U17 | **RESOLVED:** Admin must pick from a fixed list, plus `other`. When the value is `other`, admin stores a free-text note for the admin app only. The caregiver app has no new field, so it displays "Other". Lists: gender `female`, `male`, `other`; appointment type `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other`; hazard type `fall_risk`, `other`; severity `low`, `moderate`, `high`, `other`; proficiency `native`, `fluent`, `intermediate`, `basic`, `other`. Decided 2026-10-19. | The app humanizes any string | Severity `low` and the proficiency values besides `native` were not in the sample. They were added so the closed list is usable |
| U18 | **RESOLVED:** The caregiver `PUT /appointments/{id}` is cancel only. It must send `appointmentStatus: "cancelled"` and `cancellationReason`. Any other `appointmentStatus` from the caregiver app is rejected. Decided 2026-10-19. | | |
| U19 | **RESOLVED:** Completing one day does not set `appointmentStatus` to `completed`. It stays `scheduled` until every day in the range is completed, or an admin marks the whole appointment completed. That day's visit still uses `dailyVisitStatus: "completed"`. Decided 2026-10-19. | | |
| U20 | **RESOLVED:** First admin release has an audit log of admin changes and a visit history screen for check-ins, checklist toggles, daily completions, and cancellations. No charts or exported reports. Dashboard counts still apply. Decided 2026-10-19. | | |

## Justified Flutter changes (separate from the contract)

These are the only mobile edits this audit supports. They are not required to write the spec, and they are not permission to redesign the API.

| Change | Required? | Reason |
|---|---|---|
| Set `ApiConstants.baseUrl` to the new host | Yes, to talk to the new server | Environment only |
| Uncomment each `SERVER_DOWN` call and remove the `DemoData` line beside it | Yes, or the app never leaves demo mode | The calls already match this contract |
| Delete or stop referencing `demo_data.dart` after that | Yes, once uncommented | Demo mutations would diverge from the server |
| Add `cancellationReason` to the cancel PUT body | Yes. Unavoidable | The server requires it. The current body is `{ "appointmentStatus": "cancelled" }` and returns 422. The new body is `{ "appointmentStatus": "cancelled", "cancellationReason": "<text>" }` |
| Send `appointmentId` on care-plan check-in | Only when two visits can match | The unique-match fallback serves the current body. Overlapping visits return 422 until this field is added |
| Send `X-Timezone` | No | Absence means `America/Vancouver` |
| Anything else (new fields, pagination, renamed statuses, Dio migration) | No | Would change the caregiver contract |

### `SERVER_DOWN` sites to uncomment later

| File | Call |
|---|---|
| `lib/features/auth/controller/auth_controller.dart` | `POST /auth/login` |
| `lib/features/dashboard/controller/dashboard_controller.dart` | GET appointments by caregiver |
| `lib/features/client/controller/clients_controller.dart` | GET clients by caregiver |
| `lib/features/client/controller/client_detail_controller.dart` | GET client |
| `lib/features/appointment/controller/appointment_detail_controller.dart` | GET appointment, check-in, daily completion, cancel |
| `lib/features/appointment/view/appointment_care_plan_view.dart` | completion toggle |

`ApiClient` refresh is already live.

## Blockers before backend implementation

A1–A15 and U1–U20 are decided. Backend implementation can start.

These are compatibility limits, not missing product rules:

1. Cancel with the current body returns 422 until Flutter adds `cancellationReason`.
2. Check-in with the current body returns 422 when more than one scheduled active appointment for that caregiver and client covers `date`.
3. `DemoData.markCheckedIn` sets `dailyVisitStatus` to `in_progress`. The server must leave it `pending` and set `checkInTime`.

No further caregiver auth, report-export, severity, or proficiency decision is open. Do not add OTP, exported reports, or a caregiver-visible admin note.

## Do not guess these into the API

- OTP length, email templates, or reset-token expiry
- Payment, invoice, or insurance entities
- Push notification payloads
- A `success: false` convention with HTTP 200
- Numeric ids
- Renaming `dailyVisitStatus` or collapsing it into `appointmentStatus`
- Wrapping the appointment list in `meta`
- Removing the inner `data` array from the clients list
