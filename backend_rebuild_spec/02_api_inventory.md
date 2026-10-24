# 02 — API Inventory

**CONFIRMED** means the Flutter source defines the method, path, body, or parser. **INFERRED** means the behavior is required for the screens to work but is not proven by a captured response. **UNKNOWN** means the source does not establish it.

Base URL: `ApiConstants.apiBaseUrl` = `https://api.senoriaseniors.com` + `/api/v1`.

Default headers on every `ApiClient` call:

```text
Content-Type: application/json
Accept: application/json
Authorization: Bearer <accessToken>    # only when requiresAuth is true and a token is stored
```

No cookies. No multipart. No idempotency keys. No API version header beyond the path prefix.

**DECIDED header, not sent by this app:** `X-Timezone`, an IANA name such as `America/Vancouver`. `ApiConstants.defaultHeaders` and `ApiClient._buildHeaders` do not set it. Refresh does not set it either. When the header is missing or not a valid IANA name, the server uses `America/Vancouver` for `completedToday` and `activeToday`. Do not infer a zone from the UTC `timestamp` and the `date` field. Details are in `10_open_questions_and_assumptions.md`.

## Envelope

**CONFIRMED** in `ApiClient._handleResponse` (`lib/services/api/api_client.dart` 283–331).

Success is HTTP 200–299. The return value is `json['data']`. A `success` field is mentioned in a comment and is not read.

```json
{
  "message": "string, optional",
  "code": "string, optional",
  "data": "<endpoint-specific>"
}
```

Error body, any non-2xx status the client understands:

```json
{
  "message": "string, optional",
  "code": "string, optional",
  "errors": {
    "fieldName": ["string", "string"]
  }
}
```

`errors` values may also be a single string; the client wraps that into a one-element list. If `errors` is not a JSON object, it is ignored.

`message` and `code` are cast with `as String?` before the success branch (`api_client.dart` 306–312). **CONFIRMED:** on every status, including 2xx, each of those fields must be a string, JSON null, or omitted. A number or object throws, and `_send` wraps that as `ApiException('Unexpected error: ...')`. The useful `data` is then lost.

Status mapping:

| Status | Client type | Default message if `message` is absent |
|---|---|---|
| 400 | `BadRequestException` | `Request failed (HTTP 400).` |
| 401 | `UnauthorizedException` | `Your session has expired. Please log in again.` |
| 403 | `ForbiddenException` | `You do not have permission to do that.` |
| 404 | `NotFoundException` | `The requested resource was not found.` |
| 422 | `ValidationException` | `Request failed (HTTP 422).` |
| 500+ | `ServerException` | `Something went wrong. Please try again later.` |
| other | `ApiException` | `Request failed (HTTP <status>).` |

Socket failure and timeout throw `NetworkException` and never reach the server. The app shows `ApiException.message` in a snackbar or an error string on the screen.

On 401, if the call required auth, is not itself `/auth/refresh`, and has not already been retried, the client posts the refresh token and retries once. If refresh fails, `onUnauthorized` clears the session and opens login.

## Endpoint index

| # | Method | Relative path | Auth | Used by | Response `data` established? |
|---|---|---|---|---|---|
| 1 | POST | `/auth/login` | No | Login screen | Yes |
| 2 | POST | `/auth/refresh` | No | `ApiClient` after 401 | Yes |
| 3 | UNKNOWN | `/auth/logout` | Unknown | Never called | No |
| 4 | UNKNOWN | `/auth/forgot-password` | Unknown | Never called | No |
| 5 | UNKNOWN | `/auth/reset-password` | Unknown | Never called | No |
| 6 | GET | `/appointments/caregiver/{caregiverId}` | Yes | Dashboard | Yes, array |
| 7 | GET | `/appointments/{id}` | Yes | Appointment detail | Yes, object |
| 8 | PUT | `/appointments/{id}` | Yes | Cancel appointment | Decided: full appointment. Parsed when `data` contains `id` |
| 9 | POST | `/appointments/{id}/daily-completion/toggle` | Yes | Mark complete for a day | Decided: `{ appointmentId, date, completed: true }`. Client discards it and refetches |
| 10 | GET | `/clients/caregiver/{caregiverId}` | Yes | Clients list | Yes, `{ data, meta }` |
| 11 | GET | `/clients/{id}` | Yes | Client detail | Yes, object |
| 12 | POST | `/care-plans/{carePlanId}/check-in` | Yes | Appointment detail | Decided: full appointment, with `dailyVisitStatus` still `pending`. Client ignores the body and refetches |
| 13 | POST | `/care-plans/{carePlanId}/completions/toggle` | Yes | Care-plan checklist | Yes, `{ completed: bool }` preferred |

Sorting parameters: none. File upload: none. Background tasks and push handlers: none.

Ten paths have call sites. The method is confirmed for those ten. Rows 3–5 are path constants only.

`{caregiverId}` is `TokenStorageService.userId`, which is the login user's `id` string. Dynamic paths are built in `ApiEndpoints` by string interpolation. `ApiClient` is the only shared client. Refresh is a separate `http.post` to the same refresh path.

---

## 1. POST `/auth/login`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/auth/login` | CONFIRMED |
| Auth | `requiresAuth: false` | CONFIRMED |
| Caller | `AuthController.login` | CONFIRMED, currently commented |
| Source | `lib/features/auth/controller/auth_controller.dart` 88–100 | |
| Screen | `LoginView` | |

**Body (CONFIRMED):**

| Field | JSON type | Required by client | Notes |
|---|---|---|---|
| `email` | string | Yes, client-validated | Trimmed |
| `password` | string | Yes, client-validated | Minimum 6 characters on the client |
| `role` | string | Yes | Always the literal `CAREGIVER`. Not collected in the UI |

**Query / path params:** none.

**Success `data` (CONFIRMED, `LoginResponseModel`):**

| Field | JSON type | Null / missing behavior |
|---|---|---|
| `user` | object | Missing becomes an empty user (blank strings) |
| `user.id` | string | `""` |
| `user.email` | string | `""` |
| `user.firstName` | string | `""` |
| `user.lastName` | string | `""` |
| `user.role` | string | `""`, then rejected by the role check |
| `user.avatar` | string or null | stays null |
| `user.permissions` | array of strings | missing becomes `[]`. Non-strings are `toString()`'d |
| `accessToken` | string | `""` |
| `refreshToken` | string | `""` |
| `expiresIn` | number (int) | missing becomes `0`. A JSON string throws and the login fails as a generic error. **DECIDED value:** `86400` (24 hours). The demo stub used `3600`. The app parses the number and does not store it |

After parse, `user.role.toUpperCase()` must equal `CAREGIVER`. Otherwise tokens are cleared and the snackbar says the account is not authorized. **DECIDED:** this endpoint accepts `role: "CAREGIVER"` only and issues a caregiver JWT. Admins authenticate in the separate admin application. `permissions` is always `[]`.

**Errors the UI handles:** 422 shows `message`. 401 shows a fixed invalid-credentials string (the server `message` is ignored for 401). Other `ApiException`s show `message`.

**Pagination / upload:** none.

---

## 2. POST `/auth/refresh`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/auth/refresh` | CONFIRMED |
| Auth header | Not sent | CONFIRMED |
| Caller | `ApiClient._performRefresh` | CONFIRMED, live code |
| Source | `lib/services/api/api_client.dart` 190–232 | |
| Trigger | 401 on any other authenticated call | |

**Body (CONFIRMED):**

```json
{ "refreshToken": "<stored refresh token>" }
```

**Success `data` (CONFIRMED, `RefreshTokenResponseModel`):**

| Field | JSON type | Rule |
|---|---|---|
| `accessToken` | string | Empty string is treated as refresh failure |
| `refreshToken` | string | If empty, the previous refresh token is kept |
| `expiresIn` | int | Parsed, never stored. **DECIDED value:** `86400` |

`data` must be a JSON object. Refresh failure (network, non-2xx, non-object, empty access token) returns false. The original 401 is then rethrown and the session is cleared.

**DECIDED:** every successful refresh returns a new opaque refresh token and invalidates the previous one. The new `refreshToken` must be non-empty, because an empty value makes the app keep the old token. Reuse of the old token returns 401. Access token in this payload is a new JWT. Lifetime of the refresh token is 30 days.

---

## 3. `/auth/logout` (method UNKNOWN)

| Item | Value | Status |
|---|---|---|
| Path | `/api/v1/auth/logout` | CONFIRMED constant only |
| Source | `lib/services/api/api_endpoints.dart` 7 | |
| Caller | None | CONFIRMED |

`AuthController.logout` (`auth_controller.dart` 138–145) clears GetStorage and navigates to login. It does not call this path.

**UNKNOWN** as a caregiver call: the constant has no method, and the app never calls it. **DECIDED for caregiver v1:** logout stays local. Do not require this app to call the path. An admin sets or resets the caregiver password in the admin app. There is no caregiver forgot-password or reset-password flow.

---

## 4. `/auth/forgot-password` (method UNKNOWN)

| Item | Value | Status |
|---|---|---|
| Path | `/api/v1/auth/forgot-password` | CONFIRMED constant only |
| Source | `api_endpoints.dart` 9, `login_view.dart` 317–320 | |
| Caller | None. Button `onPressed` is `() {}` | CONFIRMED |

**DECIDED:** caregiver v1 does not call this path. There is no email, OTP, or reset-link flow. An admin sets the caregiver password. Do not invent an OTP contract for the mobile app.

---

## 5. `/auth/reset-password` (method UNKNOWN)

| Item | Value | Status |
|---|---|---|
| Path | `/api/v1/auth/reset-password` | CONFIRMED constant only |
| Caller | None | CONFIRMED |

**DECIDED:** caregiver v1 does not call this path. Password changes are an admin action. Do not invent a reset body for the mobile app.

---

## 6. GET `/appointments/caregiver/{caregiverId}`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/appointments/caregiver/{caregiverId}` | CONFIRMED |
| Auth | Bearer, default `requiresAuth: true` | CONFIRMED |
| Caller | `DashboardController.fetchAppointments` | CONFIRMED, commented |
| Source | `lib/features/dashboard/controller/dashboard_controller.dart` 29–51 | |
| Also consumed by | Dashboard, All Appointments (same in-memory list) | CONFIRMED |

**Path parameter:** `caregiverId` string. If the stored user id is missing, the client never calls the API and shows `Unable to identify the logged-in caregiver.`

**Query parameters:** none. Search text and status tabs on All Appointments are applied locally to `appointmentStatus` (`scheduled`, `completed`, `cancelled` / `canceled`).

**Success `data`:** a JSON array of appointment objects. See `AppointmentModel` in `03_data_models.md`. Non-map entries are skipped. The whole call fails if one object's `fromJson` throws (wrong JSON types).

**DECIDED scope:** return only appointments assigned to the authenticated caregiver. If `{caregiverId}` is not the token subject, or the appointment belongs to another caregiver, return **404**. The client shows `message` and does not branch on 403 versus 404. The product choice is 404 so the other caregiver's resource is hidden.

**Empty list:** `data: []` is valid. The dashboard shows an empty state.

**Pagination:** none. Returning a `{ data, meta }` object here will crash the cast to `List`.

---

## 7. GET `/appointments/{id}`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/appointments/{id}` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `AppointmentDetailController.fetchDetail` | CONFIRMED, commented |
| Source | `appointment_detail_controller.dart` 49–70 | |
| Screen | Appointment detail | |

**Path parameter:** appointment `id` string, from navigation arguments.

**Success `data`:** one appointment object. Same schema as each list element. The detail screen expects the embedded `client` to include languages, hazards, emergency contacts, service requirements, and care plans. The list comment says list responses may only fill client `firstName` and `lastName`; the detail parser still accepts full objects. Safest compatible behavior: return the full embed on both list and detail. A thin list embed still parses.

**Not in the appointment client embed:** diagnoses. The appointment screen shows a static unavailable section for diagnoses. They are loaded only from `GET /clients/{id}`.

**404:** message shown on the detail error state. **DECIDED:** an appointment assigned to another caregiver is also 404, including when the id exists.

---

## 8. PUT `/appointments/{id}`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/appointments/{id}` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `AppointmentDetailController.cancelAppointment` | CONFIRMED, commented |
| Source | `appointment_detail_controller.dart` 194–207 and 210–228 | |
| Screen | Appointment detail action bar | |

**Body the commented client sends (CONFIRMED):**

```json
{ "appointmentStatus": "cancelled" }
```

British spelling `cancelled` is what the client writes. The UI also treats `canceled` as cancelled when reading.

**Gap (CONFIRMED):** the dialog requires a non-empty reason and passes it into `cancelAppointment(reason)`, but the commented JSON does not include `cancellationReason`. `DemoData.cancelAppointment` stores the reason locally. The HTTP body drops it.

**DECIDED server rule:** `cancellationReason` is required. The body must be `{ "appointmentStatus": "cancelled", "cancellationReason": "<non-empty text>" }`. Any other `appointmentStatus` is rejected. A missing or blank reason is 422. This is incompatible with the current commented body.

**No safe server-side substitute.** The typed reason is not present in the body, the query string, or any header. A placeholder would not be the caregiver's reason. Cancel for this app works only after Flutter adds the field it already collected. The comparison is in `10_open_questions_and_assumptions.md`.

**Success `data` (CONFIRMED consumption rule):**

- If `data` is an object that contains the key `id`, it is parsed with `AppointmentModel.fromJson` and shown immediately.
- Otherwise the client calls `GET /appointments/{id}` again.

Returning the full updated appointment is the compatible choice. `data: null` also works because of the refetch branch.

**DECIDED effects the response, and the next GET, must show:** `appointmentStatus: "cancelled"`, the stored `cancellationReason`, `dailyVisitStatus: "cancelled"`, and `activeToday: false`. The action bar hides when `isCancelled` is true. `appointmentStatus` stays the visit state. The separate `status` field remains `active` or `inactive` and is not set to `cancelled`.

---

## 9. POST `/appointments/{id}/daily-completion/toggle`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/appointments/{id}/daily-completion/toggle` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `AppointmentDetailController.completeAppointment` | CONFIRMED, commented |
| Source | `appointment_detail_controller.dart` 169–191 | |

**Body (CONFIRMED):**

```json
{ "date": "YYYY-MM-DD" }
```

`date` comes from `DateFormatter.isoDate`. The dialog defaults to the device's local today and lets the caregiver change it. This is a calendar date, not a UTC timestamp.

**Response (DECIDED shape, CONFIRMED handling):** the controller sets `alwaysRefetch: true` and ignores the body. Comment at lines 188–189: "The toggle endpoint returns a completion record, not the full appointment." The record is `{ "appointmentId", "date", "completed": true }` even on a repeat call.

Any 2xx with a JSON object envelope is enough. Prefer a small record so the comment stays true:

```json
{
  "message": "Visit updated",
  "data": {
    "appointmentId": "appt_123",
    "date": "2026-10-19",
    "completed": true
  }
}
```

The client will not parse those fields. The following `GET /appointments/{id}` must show the new daily state.

**DECIDED: not an undo.** The path contains `toggle`, and the button is "Mark Completed for the day". A second call for the same appointment and date stays completed. It does not clear `completedToday`. The response record stays `{ "appointmentId", "date", "completed": true }`. The app ignores that body and refetches. Completing one day does not set `appointmentStatus` to `completed`. It stays `scheduled` until every day in the range is completed, or an admin marks the whole appointment completed. That day's `dailyVisitStatus` becomes `completed`.

**Client gates before the call (CONFIRMED):** the button is enabled only when every care-plan item has `completedToday == true`, the scheduled day is today or earlier, and a submit is not already in flight. The action bar is visible when `isDailyVisitOpen` and either `isCheckedIn` (`checkInTime` or the in-memory map) or `dailyVisitStatus` is `in_progress` / `ongoing`. After the decided check-in, the bar shows because `checkInTime` is set and the status is still `pending`. The server should still reject completion when the checklist for that date is incomplete, the date is outside the range, or the visit is cancelled.

---

## 10. GET `/clients/caregiver/{caregiverId}`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/clients/caregiver/{caregiverId}` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `ClientsController._requestPage` | CONFIRMED, commented |
| Source | `lib/features/client/controller/clients_controller.dart` 108–166 | |
| Screen | My Clients | |

**Query parameters (CONFIRMED):**

| Name | Sent as | Required | Notes |
|---|---|---|---|
| `page` | decimal string of an int, starting at 1 | Always | `toString()` of an int |
| `pageSize` | string of int | Always | Constant `10` |
| `status` | `active` | Always | Constant `clientStatus` |
| `search` | trimmed string | Only when non-empty | Debounced 400 ms. UI copy says search by name |

Query values are strings on the wire because `_buildUri` calls `toString()`. The server should accept numeric strings for `page` and `pageSize`.

**No sort parameter.**

**Critical nesting (CONFIRMED):** `ApiClient` already unwraps the outer `data`. The controller then reads `payload['data']` and `payload['meta']`.

HTTP body:

```json
{
  "message": "ok",
  "data": {
    "data": [ { "id": "client_1", "firstName": "Margaret", "lastName": "Chen" } ],
    "meta": {
      "total": 1,
      "page": 1,
      "pageSize": 10,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

If the unwrapped payload is not an object, the screen shows an empty list and zero totals (no error). If `meta` is missing, totals become 0 and `hasNextPage` is false, so infinite scroll stops.

`meta` integers must be JSON numbers. `hasNextPage` and `hasPreviousPage` must be JSON booleans.

**Search behavior (INFERRED from demo, not from a server):** demo matches `firstName + lastName` case-insensitively. The server should do at least that. Matching phone or email is safe if it does not break name search.

**List vs detail (CONFIRMED comment in `ClientModel`):** the list may be lightweight. The parser still accepts address, diagnoses, hazards, languages, emergency contacts, care plans, and appointments when present. Missing lists become `[]`. The list screen only needs identity and display fields (name, gender, phone, status, avatar seed from `id`).

**DECIDED scope:** only clients assigned to this caregiver, and only `status=active` as requested. The app never sends another status. Another caregiver's id, or a client that is not assigned to the token subject, returns **404**. Many caregivers may be assigned to one client. Each caregiver still receives only their own assignments.

---

## 11. GET `/clients/{id}`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/clients/{id}` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `ClientDetailController.fetchDetail` | CONFIRMED, commented |
| Source | `client_detail_controller.dart` 36–54 | |
| Screen | Client detail | |

**Success `data`:** one `ClientModel` object. Address should be a nested `address` object (see models). Include diagnoses, languages, emergency contacts, hazards, care plans (with tasks, medications, diet, hygiene), and the `appointments` summary array.

Care-plan detail from this screen is local navigation with the already parsed `CarePlanModel`. There is no `GET /care-plans/{id}`.

**404 / 401:** error string on the screen. 401 follows the global refresh path. **DECIDED:** a client assigned to another caregiver is 404, even when the id exists. The same 404 applies to that client's care plans when this caregiver is not assigned.

---

## 12. POST `/care-plans/{carePlanId}/check-in`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/care-plans/{carePlanId}/check-in` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `AppointmentDetailController.checkIn` | CONFIRMED, commented |
| Source | `appointment_detail_controller.dart` 113–167 | |
| Screen | Appointment detail, per care-plan card | |

**Body (CONFIRMED):**

| Field | JSON type | Format |
|---|---|---|
| `timestamp` | string | `DateTime.now().toUtc().toIso8601String()` |
| `location` | object | |
| `location.latitude` | number | device latitude |
| `location.longitude` | number | device longitude |
| `date` | string | local `YYYY-MM-DD` from `DateFormatter.isoDate` |

Location errors (`LocationException`) are thrown before the request. They are not API errors.

**Response:** the app ignores the body and then calls `GET /appointments/{id}` and reloads the dashboard list. **DECIDED `data`:** the full appointment object. The refetch is what the screen uses.

**DECIDED server effects the refetch must show:** `checkInTime` set to a non-empty string, `dailyVisitStatus` still `pending`, `activeToday: true`, `completedToday: false`. Do not copy `DemoData.markCheckedIn`, which sets `dailyVisitStatus` to `in_progress`. The action bar still appears because `isCheckedIn` is true when `checkInTime` is non-empty and `isDailyVisitOpen` stays true for `pending`. The UI also treats `in_progress` and `ongoing` as in progress, but this check-in must not move the status off `pending`.

Per-plan check-in timestamps are **not** read back from the appointment payload (controller comment, lines 25–27). They live in memory for the current screen session. A cold reopen only knows the appointment-level `checkInTime`, so the per-plan Check In button can appear again.

**Appointment link (CONFIRMED gap, DECIDED rule):** the commented body has no `appointmentId`. The controller already holds `_appointmentId` and does not put it in the JSON. When the field is absent, bind the check-in only if exactly one of this caregiver's `scheduled`, `active` appointments for that care plan's client covers `date`. Zero matches is 404 when the care plan is not this caregiver's, and 422 when it is but no single visit matches. More than one match is 422. Do not choose among them. Do not filter on `appointment.carePlanId`; every care plan on that client may be checked in. When a future body includes `appointmentId`, use that id after the same ownership checks. Rejecting every body that omits the field would break the current app.

**Client gates (CONFIRMED):** no double check-in for the same plan id in memory; ignores empty plan id; one check-in request at a time. The Check In button is shown when `checkInEnabled` is true: daily visit is open (`activeToday && !completedToday &&` daily status is not cancelled/canceled/missed) and the appointment is not a future calendar day. `canCheckIn` additionally requires `dailyVisitStatus == pending`, but the card uses `isDailyVisitOpen` plus local "not yet checked in." Server should reject check-in when the visit day is in the future, the visit is cancelled, or it is already completed.

---

## 13. POST `/care-plans/{carePlanId}/completions/toggle`

| Item | Value | Status |
|---|---|---|
| Full path | `/api/v1/care-plans/{carePlanId}/completions/toggle` | CONFIRMED |
| Auth | Bearer | CONFIRMED |
| Caller | `AppointmentCarePlanView._toggle` | CONFIRMED, commented |
| Source | `lib/features/appointment/view/appointment_care_plan_view.dart` 58–111 | |
| Screen | Appointment care-plan checklist | |

**Body (CONFIRMED):**

| Field | JSON type | Values |
|---|---|---|
| `itemType` | string | `task`, `medication`, `diet`, or `hygiene` |
| `itemId` | string | id of that item |
| `date` | string | local `YYYY-MM-DD` for `DateTime.now()` |

**Success `data` (CONFIRMED):** if `data` is an object and `data.completed` is a bool, that bool replaces the optimistic UI state. If it is missing, the optimistic value (the inverse of the previous `completedToday`) stays.

```json
{ "message": "Updated", "data": { "completed": true } }
```

**On API error:** the optimistic check is reverted and `message` is shown.

**DECIDED:** this is a real toggle. A second call for the same item and date sets `completed` to the opposite bool. The next appointment or client fetch must return that item's `completedToday` matching `completed`. Unknown item type or unknown id is 404 when the care plan is outside this caregiver's assignments, and 422 when the plan is theirs but the item does not belong to it. The checklist is only opened as editable after an in-memory check-in for that plan. The server still requires a check-in for that visit date. `completedToday` on reads is true only for the current day in `X-Timezone`, or in `America/Vancouver` when that header is absent.

---

## Duplicate and dynamic paths

| Pattern | Notes | Status |
|---|---|---|
| `appointmentById` used for GET and PUT | Same path, two methods | CONFIRMED |
| Ids interpolated into paths | All ids are strings from JSON `id` or the stored user | CONFIRMED |
| No second HTTP client | Only `ApiClient` and the refresh `http.post` | CONFIRMED |

## Components that call the network

| Component | Endpoints |
|---|---|
| `AuthController.login` | POST `/auth/login` |
| `ApiClient._performRefresh` | POST `/auth/refresh` |
| `AuthController.handleSessionExpired` | none (local clear) |
| `DashboardController.fetchAppointments` | GET appointments by caregiver |
| `ClientsController._requestPage` | GET clients by caregiver |
| `ClientDetailController.fetchDetail` | GET client by id |
| `AppointmentDetailController.fetchDetail` | GET appointment by id |
| `AppointmentDetailController.checkIn` | POST care-plan check-in, then GET appointment and GET appointments |
| `AppointmentDetailController.completeAppointment` | POST daily-completion toggle, then GET appointment and GET appointments |
| `AppointmentDetailController.cancelAppointment` | PUT appointment, then maybe GET appointment, then GET appointments |
| `AppointmentCarePlanView._toggle` | POST care-plan completion toggle |

All of the controller and view calls above are commented behind `SERVER_DOWN` except refresh, which is live and unused until some other call returns 401.
