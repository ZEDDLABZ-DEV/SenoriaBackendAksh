# 01 — Admin API Inventory

All paths below are relative to:

```
https://api.senoriaseniors.com/api/v1
```

**CONFIRMED** in `lib/shared/services/api/api_constants.dart` (`baseUrl`, `apiVersion`, `fullBaseUrl`). `ApiClient._resolveUrl` prefixes any path that does not already start with `http://` or `https://`. No caller passes an absolute URL.

## Shared transport rules

**CONFIRMED** in `ApiClient` and `ApiConstants`.

| Rule | Behavior |
|---|---|
| Methods implemented | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. Only the first four verbs except PATCH are used. PATCH has no caller. |
| Content type | `Content-Type: application/json` and `Accept: application/json` on every request, including refresh. |
| Client header | `X-Client: senoria-admin/1.0.0` on every request, including login and refresh. |
| Auth header | If a non-empty access token is stored, `Authorization: Bearer <accessToken>` is added. Login and refresh skip the proactive refresh path. Refresh itself is sent **without** the Authorization header (it builds headers from defaults only). |
| Timeouts | Connect and receive timeout 30 seconds. Transport failure or timeout becomes a client-side `NetworkException`. There is no HTTP status for that case. |
| Query encoding | Values are stringified. `null` becomes an empty string. Iterables become lists of strings. No caller sends `null` query values. |
| Body | Dart `Map` serialized by GetConnect as JSON. No multipart, no file upload, no file download. |
| Success | Status `200`–`299` returns the JSON object. A JSON array body is rewritten to `{ "data": <array> }`. A non-map, non-list body becomes `{ "data": <value> }`. An empty body becomes `{}`. |
| Error message | Prefer `error.message` (string). Else top-level `message`. Else `"Request failed"`. **Decided:** send both `error.message` and top-level `message` with the same text, plus `error.fields` and top-level `errors` (map of string arrays). |
| Error code | Prefer `error.code` (string). Else top-level `code`. |
| Error fields | Prefer `error.fields` (object). Else top-level `fields`. Else top-level `errors`. |
| Status map | `400` BadRequest, `401` Unauthorized (and session end — see auth doc), `403` Forbidden, `404` NotFound, `422` Validation, `500`–`599` Server, anything else Unknown. |
| Retry | On `401` for a non-auth path, the client refreshes once and retries the original request once. Auth paths are `/auth/login` and `/auth/refresh` (substring match). |

Pagination, sorting, and filtering differ per endpoint and are listed below. There is no global sort parameter.

---

## 1. POST `/auth/login`

| | |
|---|---|
| Auth | No bearer token required. Proactive refresh is skipped. |
| Query | None. |
| Body | `{ "email": string, "password": string }`. Email is trimmed. Password is not trimmed. **Role is not sent.** |
| Semantics | **Decided.** Do not require `role`. If a client sends `role`, ignore it and use the role stored on the account. Exactly one user has role `ADMIN`. Every other user is `CAREGIVER`. |
| Success | Envelope parsed by `LoginResponse`. `data.accessToken` and `data.refreshToken` must be strings (non-nullable casts). **Decided:** `data.expiresIn` is `3600`. The refresh token is valid for 7 days from this login. `data.user` must be an object. `user.id` and `user.email` must be strings. See models doc. |
| Error | `401` shows a fixed invalid-credentials snackbar and does **not** end a session (no token stored yet, and the path is an auth endpoint so `SessionService` returns false). `422` shows `error.message` / `message`. Other `ApiException` messages are shown. |
| Caller | `AuthController.login` (`lib/features/auth/controllers/auth_controller.dart` lines 67–71). Screen: Login. |
| Workflow | Admin sign-in. After a successful parse, the app rejects the session unless `user.role` uppercased equals `ADMIN`. Tokens are saved only after that check. |

---

## 2. POST `/auth/refresh`

| | |
|---|---|
| Auth | No bearer token. Not subject to the 401 retry loop. |
| Query | None. |
| Body | `{ "refreshToken": string }` from GetStorage. |
| Success | Full response object (not unwrapped) parsed by `RefreshTokenResponse`. Requires `data` object and `data.accessToken` string. **Decided:** omit `data.refreshToken` so the 7-day token is kept. `data.expiresIn` is `3600`. |
| Error | Any non-2xx, transport error, or parse error returns false. The original request then fails as `401`, which clears the session if an access token was stored. A refresh after the 7-day token has expired takes this path and signs the admin out. |
| Caller | `ApiClient._performRefresh`. Not a screen. Triggered before a request when the access token is within 5 minutes of expiry (55 minutes into a 3600-second token), and once after a `401`. Concurrent refreshes share one in-flight call. `expiresIn: 0` ends the session. |
| Workflow | Silent access-token refresh. The refresh token is not rotated. |

There is **no** logout endpoint in this app.

---

## 3. GET `/dashboard/stats`

| | |
|---|---|
| Auth | Bearer. Skipped entirely if the local session flag and access token are not both present. |
| Query | `timeZoneOffset`, the device offset such as `+05:30`. **Decided:** “today” is that device’s calendar day. |
| Body | None. |
| Success | `DashboardStats.fromResponse`. Reads `data` if it is an object, otherwise the root. All eight integer fields default to `0` when missing or non-numeric. The dashboard UI displays only `totalClients` and `todayAppointments`. |
| Error | Snackbar. `401` with session already terminated does not show a second snackbar. |
| Caller | `DashboardController.fetchStats` (lines 66–69). Screen: Dashboard, on ready, on pull-to-refresh, and when navigating back to home. |
| Workflow | Admin home counts. |

---

## 4. GET `/clients`

| | |
|---|---|
| Auth | Bearer. Requires logged-in session. |
| Query | `page` starting at `1`, `pageSize` `50`, optional `search` (trimmed string). Search is omitted when empty. The phone requests the next page until the list is complete. |
| Body | None. |
| Sorting | None sent. **UNKNOWN** whether the server sorts. |
| Filtering | Server-side `search` only. **Decided:** match `firstName` or `lastName`, ignore capital letters, and match part of the word. Care-type filtering on the Clients screen stays on the phone after the response. |
| Pagination | **Decided.** The phone loads every page. It stops when `hasNextPage` is false, when `page` reaches `totalPages`, or when the loaded count reaches `total`. |
| Success | `ClientsListResponse`. Accepts `data` as a list, or `data` as an object whose list is under `clients`, `items`, `results`, or `data`. Page metadata is read from the data object, then `pagination`, then `meta`, for keys `page`, `pageSize`, `total` (fallback `totalCount`), `totalPages`. |
| Error | Snackbar, including a generic “failed to load clients” fallback. |
| Caller | `ClientController._performFetchClients` (lines 133–136). Screens: Dashboard (preview of first 4), Clients list, and a refresh after create. Also kicked from login before navigation. |
| Workflow | List all clients the admin token can see. |

---

## 5. POST `/clients`

| | |
|---|---|
| Auth | Bearer. |
| Query | None. |
| Body | `CreateClientRequest.toJson()`. Exact keys in the models doc and fixtures. `dateOfBirth` is `yyyy-MM-dd`. `gender` is `male`, `female`, or `other`. `address.apartment` is always `""`. |
| Success | `CreateClientResponse`. `data` may be absent. If `data` is present, the app refetches `GET /clients` and returns the created `ClientData`. The created id is not required for the create screen (it only checks non-null `data`). |
| Error | `401`, `422`, network, and other API messages are shown. |
| Caller | `ClientController.createClientRemote` (lines 246–248). Screen: Create Client. |
| Workflow | Register a client with emergency contact, diagnosis summary, one language, and an address. |

---

## 6. GET `/clients/{id}`

| | |
|---|---|
| Auth | Bearer. |
| Path | `id` is the client id string, interpolated with no encoding helper. |
| Query | None. |
| Success | Same parser as create: `CreateClientResponse` → `ClientData`. The raw `ClientData` is cached so later PUTs can resend fields the UI model drops (`dateOfBirth`, `emergencyContactRelation`, `address.apartment`, `email`, `status`). A missing `data` object returns null without a snackbar. |
| Error | `404` shows “client not found”. Other failures show the server message or a generic load-details message. |
| Caller | `ClientController.fetchClientById` (lines 192–194). Screen: Client Detail (open and pull-to-refresh). Also called from the appointment form when a client is selected, and internally before PUT if the cache is empty. |
| Workflow | Full client profile, including nested diagnoses, languages, hazards, service requirements, care plans, appointments, and address. |

---

## 7. PUT `/clients/{id}`

| | |
|---|---|
| Auth | Bearer. |
| Path | Client id. |
| Query | None. |
| Body | **Two different shapes**, chosen in `updateClientRemote`. |

**Shape A — diagnosis or language edit** (`_buildClientPayload`, lines 368–393). Same flat keys as POST `/clients`, rebuilt from the cached `ClientData`, with only the edited section replaced:

`firstName`, `lastName`, `dateOfBirth` (`yyyy-MM-dd`, or `""`), `phone`, `gender` (lowercased, default `female`), `emergencyContactName`, `emergencyContactRelation`, `emergencyContactPhone`, `primaryCondition`, `medicalConditions` (string array), `allergies` (string array), `language`, `communicationNote`, `address` object (`street`, `city`, `state`, `zipCode`, `country`, `apartment`, `gateAccessCode`, `navigationInstructions`).

Does **not** send `email` or `status`.

**Shape B — directions-only edit** (`_buildDirectionsUpdatePayload`, lines 408–427), used only when `directions` is set and diagnosis and language are both null:

`firstName`, `lastName`, `email` (or `""`), `phone`, `dateOfBirth`, `gender` (lowercased, default `female`), `status` (`active` or `inactive`; cached value, or `"active"` when missing), `address` (same keys as shape A, with the edited directions).

Does **not** send diagnosis, language, or emergency-contact fields.

**Decided semantics.** Merge. Update only keys present in the body. Omitted scalar fields and child lists stay as stored. A directions save must not wipe diagnoses, languages, emergency contacts, service requirements, hazards, or care plans. A diagnosis or language save must not wipe `email` or `status`.

| | |
|---|---|
| Success | Parsed as `CreateClientResponse`. If `data` is present, the cache and in-memory client are replaced. If `data` is absent, the app refetches `GET /clients/{id}`. |
| Error | `401`, `422`, network, and other API messages. |
| Caller | `ClientController.updateClientRemote` (lines 469–471). Sheets: Diagnosis, Language, Directions. |
| Workflow | Section edits of an existing client. Basic identity (name, phone, email, emergency contact) is **not** saved by any reachable screen. |

---

## 8. GET `/users/caregivers`

| | |
|---|---|
| Auth | Bearer. |
| Query | `page` starting at `1`, `pageSize` `100`. No search. The phone requests the next page until the list is complete. |
| Pagination | **Decided.** The phone loads every page. `hasNextPage` is followed. When that flag is missing, the next page is requested while `page` is below `totalPages` or the loaded count is below `total`. |
| Success | `CaregiversListResponse`. List from `data` as an array, or `data.data` / `data.items` / `data.results`. Meta from `data.meta`: `page`, `pageSize`, `total`, `totalPages`, `hasNextPage`, `hasPreviousPage`. Each item: `id`, `firstName`, `lastName`, `role` (position label, not the auth role `CAREGIVER`), `phone`, `email`, `avatar`. Display name is `firstName + lastName`, falling back to `email`. |
| Error | Snackbar. |
| Caller | `AppointmentController._performFetchCaregivers` (lines 327–332). Screen: Appointment create/edit, assign-caregiver dropdown. |
| Workflow | Pick a caregiver when scheduling. This is a privileged user listing. |

---

## 9. GET `/appointments`

| | |
|---|---|
| Auth | Bearer. |
| Query | `page` starting at `1`, `pageSize` `100`, optional `search`. **Decided:** `search` matches the client’s first or last name, ignores capital letters, and matches part of the word. |
| Not sent | **Decided:** `status`, `dateFrom`, and `dateTo` are not supported. The phone does not send them. Status tabs stay on the device. |
| Pagination | Loops while `meta.hasNextPage` is true and the page is non-empty. |
| Sorting | None sent. Tabs on the Appointments screen (scheduled / completed / cancelled) filter the accumulated list locally. |
| Success | `AppointmentsListResponse`. Preferred shape `{ success, data: { data: [...], meta: {...} } }`. Also accepts `data` as a list, or `data.items` / `data.results`. Item fields: `id`, `scheduledDate`, `startTime`, `endTime`, `clientName`, `caregiverName`, `status`, `type`. **Decided:** this list keeps `status` and `type`. Detail and caregiver payloads keep `appointmentStatus` and `appointmentType`. |
| Error | Snackbar. |
| Caller | `AppointmentController.fetchAppointments` (lines 113–116). Screen: Appointments. Also after login, on controller ready, and after update/delete. |
| Workflow | Admin schedule across clients, not limited to one caregiver. |

---

## 10. POST `/appointments`

| | |
|---|---|
| Auth | Bearer. |
| Query | None. |
| Body | Built in `AppointmentFormScreen._save`: `description`, `clientId`, `caregiverId`, `scheduledDate` (`yyyy-MM-dd`), `startTime` (`HH:mm`), `endTime` (`HH:mm`), `appointmentType` (string, possibly `""`), `instructions`, `notes` (the Notes field; `""` only when left blank), `locationStreet`, `locationCity`, `locationState`, `locationZipCode`, `locationGateCode`, `locationNavigation`. |
| Not sent | `appointmentStatus`, `priority`, `duration`, hazards, service requirements, care plan. `locationNavigation` is `""` or the literal prefix `Navigation Instructions: ` plus the free-text field. |
| Success | Only an id is read: `data.id`, else top-level `id`. If neither exists, the app invents `ap_<microseconds>` locally. The list is **not** refetched after create. The new row appears in the in-memory dummy/local appointment list, not necessarily in `appointmentList`, until the next list fetch. |
| Error | Snackbar. `422` is not specially branched; it falls through `ApiException`. |
| Caller | `AppointmentController.createAppointment` (lines 454–456). Screen: Create Appointment. |
| Workflow | Schedule a visit and assign a caregiver. |

---

## 11. GET `/appointments/types`

| | |
|---|---|
| Auth | Bearer. |
| Query / body | None. |
| Success | `AppointmentType.listFromResponse`. Items from `data` as an array, or `data.data`. Each item needs `value` and `label`. Empty `value` is dropped. Fetched once per session. |
| Error | Snackbar. |
| Caller | `AppointmentController._performFetchAppointmentTypes` (lines 389–391). Screen: Appointment form visit-type dropdown. |
| Workflow | Visit-type catalog. The admin app does not hardcode the allowed values. |

---

## 12. GET `/appointments/{id}`

| | |
|---|---|
| Auth | Bearer. |
| Path | Appointment id. |
| Success | `AppointmentDetail.fromResponse`. Reads `data` if it is an object. Fields and nested `client`, `caregiver`, and `tasks` are in the models doc. |
| Error | `404` shows “appointment not found”. |
| Caller | `AppointmentController.fetchAppointmentById` (lines 166–168). Screen: Appointment Detail (open, refresh, and after returning from edit). |
| Workflow | Full visit record for admin review. |

---

## 13. PUT `/appointments/{id}`

| | |
|---|---|
| Auth | Bearer. |
| Body | Built in `AppointmentFormScreen._save`. Same location and schedule fields as create, plus `appointmentStatus` (`scheduled`, `completed`, or `cancelled`). **Omits `clientId`.** `notes` is the Notes field (`""` only when left blank, which clears stored notes). `caregiverId` is included. |
| Semantics | **Decided.** Merge. Update only keys present in the body. Omitted fields stay, including `clientId` on an admin save. A body of `{ "appointmentStatus": "cancelled" }` changes status only. |
| Comment drift | A comment above the body says the update expects `status` and `priority`. The map that is actually sent uses `appointmentStatus` and does not include `priority` or `status`. The sent map is the contract. |
| Success | Response body is ignored. Then `GET /appointments` is refetched. |
| Error | `401`, `422`, network, and other API messages. |
| Caller | `AppointmentController.updateAppointmentRemote` (lines 508–510). Screen: Edit Appointment. |
| Workflow | Reschedule, reassign caregiver, change the three-value status, edit instructions and location. |

---

## 14. DELETE `/appointments/{id}`

| | |
|---|---|
| Auth | Bearer. |
| Query / body | None. |
| Success | Any 2xx. Body ignored. Local list entry removed, then `GET /appointments` refetched. |
| Error | `404` shows “appointment not found”. |
| Caller | `AppointmentController.deleteAppointmentRemote` (lines 553–555). Screen: Edit Appointment, trash action, after confirm dialog. |
| Workflow | Delete a visit. |

---

## 15. POST `/care-plans`

| | |
|---|---|
| Auth | Bearer. |
| Body | `clientId`, `name`, `description` (may be `""`), `goals` (string array, blanks removed), `status` (`active`, `inactive`, or `completed`). `startDate` and `endDate` are included only when non-null, as `yyyy-MM-dd`. |
| Success | `CreateCarePlanResponse`. Id from `data.id`, or `carePlan`, or a root object that itself has `id`. The id is stored on the local care plan. Nested item calls cannot be made without it. |
| Error | `401`, `422`, network, generic create failure. |
| Caller | `ClientController.createCarePlan` (lines 922–924). Sheet: Care Plan, only when the plan does not already have a server id. |
| Workflow | Create the client’s care plan shell. Editing an existing plan does **not** call this or any update endpoint. |

---

## 16. POST `/care-plans/{carePlanId}/diet`

| | |
|---|---|
| Auth | Bearer. |
| Body | `{ "meal", "restrictions", "description" }`, all trimmed strings. Restrictions and description may be empty. |
| Success | `CreateCarePlanDietResponse`. If `data` (or `diet`, or a root object with `meal`) is missing, the method returns null and the UI treats it as failure. |
| Caller | `ClientController.createCarePlanDiet` (lines 1094–1096). Care Plan sheet, add diet item. |
| Workflow | Add a diet row under an existing care plan. No update or delete endpoint is called. |

---

## 17. POST `/care-plans/{carePlanId}/medications`

| | |
|---|---|
| Auth | Bearer. |
| Body | `{ "medicationName", "dosage", "schedule", "description" }`. `schedule` is a short code from the UI list `OD`, `BD`, `TDS`, `QID`, `PRN`, `HS`, or a legacy free-text value already stored. |
| Success | Parsed like diet, alternate key `medication`. If `data` is null, the app still returns a local `CarePlanMedication` **without an id** and the sheet treats that as success. |
| Caller | `ClientController.createCarePlanMedication` (lines 1144–1146). |
| Workflow | Add a medication reminder. |

---

## 18. POST `/care-plans/{carePlanId}/hygiene`

| | |
|---|---|
| Auth | Bearer. |
| Body | `{ "activity", "frequency", "description" }`. |
| Success | Alternate key `hygiene`. Null `data` still counts as success via a local object without an id. |
| Caller | `ClientController.createCarePlanHygiene` (lines 1199–1201). |
| Workflow | Add a hygiene activity. |

---

## 19. POST `/care-plans/{carePlanId}/tasks`

| | |
|---|---|
| Auth | Bearer. |
| Body | `{ "name", "frequency", "description" }`. |
| Success | Alternate key `task`. Null `data` still counts as success via a local object without an id. |
| Caller | `ClientController.createCarePlanTask` (lines 1252–1254). |
| Workflow | Add a generic care task. |

---

## 20. GET `/clients/{clientId}/hazards`

| | |
|---|---|
| Auth | Bearer. |
| Success | `Hazard.listFromResponse`. List taken from `data`, else `hazards`, else `items`. Each item: `id`, `type`, `description`. |
| Error | Returns an empty list and shows a snackbar. |
| Caller | `AppointmentController.fetchHazards` (lines 632–634). Appointment form (edit) and client Hazard sheet. |
| Workflow | Load hazards for a **client**, including when the UI is the appointment editor. Hazards are not appointment-scoped in this API. |

---

## 21. POST `/clients/{clientId}/hazards`

| | |
|---|---|
| Auth | Bearer. |
| Body | `Hazard.toCreateJson()`: `type` (`environmental_risks` or `medical_risks`) and `description`. No `severity`. No `precautions`. |
| Success | Id from `data.id` or top-level `id`. Other response fields are ignored. |
| Caller | `AppointmentController.addHazard` (lines 671–673). Appointment form and client Hazard sheet. |
| Workflow | Add one hazard line. Safety instructions typed in the appointment form are **not** sent. |

---

## 22. DELETE `/clients/{clientId}/hazards/{hazardId}`

| | |
|---|---|
| Auth | Bearer. |
| Query / body | None. |
| Success | Any 2xx. Body ignored. |
| Caller | `AppointmentController.deleteHazard` (lines 707–709). Same screens as add. |
| Workflow | Remove one hazard. |

---

## 23. PUT `/clients/{clientId}/hazards/{hazardId}`

| | |
|---|---|
| Auth | Bearer. |
| Body | Same as create: `type` and `description`. |
| Success | Any 2xx. The phone does not read the body. |
| Caller | `AppointmentController.updateHazard`. Appointment form and client Hazard sheet, when the user taps a hazard and saves a new description. |
| Workflow | Edit one hazard. The admin web portal uses the same call. |

---

## Endpoints declared or commented and not called

| Path | Evidence | Classification |
|---|---|---|
| `PATCH` any path | `ApiClient.patch` exists, zero callers | Not an admin-app requirement. |
| Logout, forgot-password, reset-password | Login shows “Coming soon” and does not call the network. Logout only clears local storage. | **Decided.** Server routes `POST /auth/logout`, `POST /auth/forgot-password`, and `POST /auth/reset-password` exist. Neither phone calls them. Logout revokes the refresh token. |

## Response structures that are uncertain

These calls succeed on any 2xx and do not require a particular body:

- `PUT /appointments/{id}`
- `DELETE /appointments/{id}`
- `DELETE /clients/{clientId}/hazards/{hazardId}`

These calls only require an id when present, and tolerate a missing id:

- `POST /appointments` (missing id is replaced locally)
- `POST /clients/{clientId}/hazards` (missing id leaves the local hazard without a server id; a later delete cannot target it)

These parsers accept more than one envelope, so the original server shape is not unique:

- `GET /clients`
- `GET /users/caregivers`
- `GET /appointments`
- `GET /appointments/types`
- `GET /clients/{clientId}/hazards`
- `POST /care-plans` and the four nested item posts

`POST /care-plans/{id}/medications`, `/hygiene`, and `/tasks` treat a 2xx with no parseable entity as success. `POST /care-plans/{id}/diet` does not.
