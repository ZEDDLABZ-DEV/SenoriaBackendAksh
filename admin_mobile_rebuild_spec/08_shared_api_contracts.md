# 08 — Shared API Contracts

## Evidence boundary

This admin workspace does **not** contain a user-app reverse-engineering folder.

A sibling caregiver Flutter app is on disk:

`Senoria Senors Caretaker/senoria_seniors_caretaker`

That app is the user-facing mobile application available for comparison. Its network calls are commented out and replaced with demo data (`SERVER_DOWN` comments). Comparison below uses:

- caregiver `lib/services/api/api_endpoints.dart`
- caregiver `lib/services/api/api_constants.dart` and `api_client.dart`
- caregiver models under `lib/models/`
- commented request bodies in caregiver controllers

It does **not** use either repo’s `BACKEND_API_SPEC.md`. Those drafts disagree with the source (different hosts, and the caregiver draft asks for snake_case `access_token` while the caregiver model reads `accessToken`).

Where the caregiver call is commented, the contract is **source-intended**, not a proven live call. The admin contracts are live calls.

Both clients hardcode the same origin and prefix:

`https://api.senoriaseniors.com` + `/api/v1`

**CONFIRMED** in both `api_constants.dart` files.

## Shared endpoints

| Method and path | Admin | Caregiver source |
|---|---|---|
| `POST /auth/login` | Live. Body `{ email, password }`. Parses the **full envelope** (`success`, `message`, `data`, `timestamp`, `requestId`). | Commented. Body adds `role: "CAREGIVER"`. `ApiClient.post` returns **`json['data']` only**, and `LoginResponseModel` reads `user`, `accessToken`, `refreshToken`, `expiresIn` on that object. |
| `POST /auth/refresh` | Live. Parses the **full envelope**, then `data.accessToken`. `data.refreshToken` optional. | Implemented in the client (not commented). `_handleResponse` returns `json['data']`, then reads `accessToken`, `refreshToken`, `expiresIn` on that object. Does not update expiry from `expiresIn` in the refresh success path that was read (save call passes access and refresh only). |
| `GET /clients/{id}` | Live. `ClientData` nested object. | Commented. `ClientModel.fromJson` on the unwrapped `data`. |
| `GET /appointments/{id}` | Live. `AppointmentDetail`. | Commented. `AppointmentModel.fromJson`. |
| `PUT /appointments/{id}` | Live. Large body including schedule, caregiver, location, `appointmentStatus`. | Commented. Body is only `{ "appointmentStatus": "cancelled" }`. |

Same path does not mean the same payload. Differences are listed below and must be preserved or explicitly versioned. This audit does not pick a winner.

## Admin-only endpoints

These strings do not appear in the caregiver `ApiEndpoints` class.

- `GET /dashboard/stats`
- `GET /clients`
- `POST /clients`
- `PUT /clients/{id}`
- `GET /users/caregivers`
- `GET /appointments`
- `POST /appointments`
- `GET /appointments/types`
- `DELETE /appointments/{id}`
- `POST /care-plans`
- `POST /care-plans/{carePlanId}/diet`
- `POST /care-plans/{carePlanId}/hygiene`
- `POST /care-plans/{carePlanId}/medications`
- `POST /care-plans/{carePlanId}/tasks`
- `GET /clients/{clientId}/hazards`
- `POST /clients/{clientId}/hazards`
- `DELETE /clients/{clientId}/hazards/{hazardId}`

## Caregiver-only endpoints

Declared in caregiver source. Not called by the admin app. All feature calls are commented except the refresh implementation inside `ApiClient`.

- `POST /auth/logout`. **Decided:** revokes the current refresh token. Neither phone calls it yet.
- `POST /auth/forgot-password`
- `POST /auth/reset-password`. **Decided:** both reset routes exist. A new password must be at least 6 characters. Neither phone calls them yet.
- `GET /appointments/caregiver/{caregiverId}`
- `POST /appointments/{id}/daily-completion/toggle` with commented body `{ "date": "<iso date>" }`
- `GET /clients/caregiver/{caregiverId}`
- `POST /care-plans/{carePlanId}/completions/toggle`
- `POST /care-plans/{carePlanId}/check-in`. **Decided:** no location body for now.

`GET /clients/{id}` and `GET /appointments/{id}` are the overlap, not the caregiver-scoped list routes. Do not treat `/clients` and `/clients/caregiver/{id}` as interchangeable.

## Authentication differences

| Topic | Admin app | Caregiver app |
|---|---|---|
| Role allowed in | `ADMIN` (case-insensitive), checked after the response | `CAREGIVER` (case-insensitive), checked after the response |
| Role in the login body | Not sent. **Decided:** the server ignores `role` if present and uses the account role. | Commented body sends `role: "CAREGIVER"`. That field is ignored. |
| Password rule | UI: non-empty. **Decided** server minimum: 6 characters. No lockout. No MFA. | Commented UI requires length ≥ 6, which matches the server rule. |
| Client header | `X-Client: senoria-admin/1.0.0` | Not set. Content-Type and Accept only. |
| Who may call admin lists | **Decided.** The single `ADMIN` account. | **Decided.** A caregiver token cannot call `GET /clients`, `GET /users/caregivers`, or `DELETE /appointments/{id}`. |
| Error JSON | `error.message` / `error.code` / `error.fields`, with top-level fallbacks including `errors` | Top-level `message`, `code`, and `errors` as a map of string arrays. Does not read `error.message`. |
| Success unwrap | Admin parsers see the full body | Caregiver `ApiClient` returns `json['data']` and throws if the body is not a JSON object |
| 401 refresh | Yes, one retry | Yes, one retry, then `onUnauthorized` |
| Logout HTTP | None. **Decided:** server `POST /auth/logout` revokes the refresh token. This app does not call it. | Endpoint declared. Logout method only clears local storage and does not call it. |

**Decided — login body.** `POST /auth/login` is `{ "email", "password" }` for both apps. A `role` property is ignored. The stored account role is returned as `user.role`. There is exactly one `ADMIN` user. Every other user is `CAREGIVER`. Do not add `role` to the admin login request.

**Decided — error shape.** Do not change either parser. Every error body includes both. `message` and `error.message` carry the same text. `code` and `error.code` match. `errors` is a map of string arrays for the caregiver app. `error.fields` is the admin object for the same problems.

**Contract conflict — refresh envelope.** Both can succeed on the same body if the body is `{ "success", "message", "data": { "accessToken", "refreshToken", "expiresIn" } }`. Admin requires `accessToken` inside `data` and will throw if `data` is missing. Caregiver refresh uses `_handleResponse`, which returns `data`, and then requires `accessToken` on that object. A bare `{ "accessToken" }` without an envelope works for neither admin refresh (admin expects `data` to be a Map) nor caregiver refresh (`data` would be null). **CONFIRMED** in both parsers.

**Contract conflict — login parse depth.** Admin `LoginResponse.fromJson` expects the envelope. Caregiver `LoginResponseModel.fromJson` expects the inner `data` object because the client already unwrapped it. The wire body can be the same. The conflict is not the JSON. It is that a backend must keep the envelope, not return a bare token object.

User object fields match on both sides: `id`, `email`, `firstName`, `lastName`, `role`, `avatar`, `permissions[]`. Admin casts `id` and `email` as non-null strings. Caregiver defaults them to `""`.

## `GET /clients/{id}` field differences

Both read: `id`, `firstName`, `lastName`, `dateOfBirth`, `gender`, `phone`, `email`, `profileImage`, `notes`, `status`, nested `address` (`street`, `apartment`, `city`, `state`, `zipCode`, `country`, `gateAccessCode`, `navigationInstructions`), `languages`, `emergencyContacts`, `diagnoses`, `hazards`, `carePlans`, `appointments`.

| Field | Admin | Caregiver |
|---|---|---|
| `serviceRequirements` | Parsed and shown | Not on `ClientModel` |
| Address latitude/longitude | Parsed. **Decided:** unused for now. Omit or send `null`. | Not read (caregiver also accepts flat `addressStreet`-style aliases) |
| `createdAt`, `updatedAt`, `createdById`, `updatedById`, `deletedAt` | Parsed. **Decided:** `deletedAt` is unused. A deleted client row is removed. | Not on `ClientModel` |
| Care plan item `completedToday` | Not read | Read on task, medication, diet, hygiene |
| Embedded appointment `doctorName`, `doctorSpecialty`, `doctorPhone`, `clinicName` | Not read | Read. UI treats `appointmentType == doctor_visit` as a doctor visit |
| Embedded appointment `title`, `duration`, `instructions`, `caregiverId` | Read | Caregiver embedded model uses `description` instead of `title` and does not read duration/instructions |
| Hazard `type` | Grouped only for `environmental_risks` and `medical_risks` | Grouped by whatever `type` string arrives |

Care plan item names match: tasks use `name`; medications use `medicationName` (caregiver also accepts `name`); diet uses `meal` and `restrictions`; hygiene uses `activity`. Admin additionally reads medication `dosage` and `schedule`. Caregiver reads those too, and accepts `frequency` as a fallback for `schedule`.

**Decided — PUT is a merge.** `PUT /clients/{id}` updates only fields present in the body and leaves omitted fields and child lists unchanged. Shape A omits `email` and `status`. Shape B omits diagnoses, languages, and emergency contact. Service requirements, extra languages, ICD codes, hazards, and care plans are never in either body, so they stay.

## `GET /appointments/{id}` field differences

Shared and read by both: `id`, `description`, `scheduledDate`, `startTime`, `endTime`, `duration`, `appointmentType`, `appointmentStatus`, `instructions`, `notes`, `checkInTime`, `checkOutTime`, `status`, location fields, `clientId`, `caregiverId`, `carePlanId`, nested `client` and `caregiver`.

| Field | Admin detail | Caregiver model |
|---|---|---|
| `tasks[]` | Read (`title`/`name`, `description`, `isCompleted`/`completed`). **Decided:** these are the client’s care-plan tasks, not a separate appointment list. | Not on `AppointmentModel` |
| `endDate` | Not read | Read |
| `cancellationReason` | Not read | Read |
| `completedToday`, `activeToday`, `dailyVisitStatus` | Not read | Read |
| `createdAt`, `updatedAt` | Read | Not on the portion reviewed |
| Party `emergencyContacts`, `carePlans` | Read on `AppointmentParty` | Caregiver has its own client/caregiver nested models |

**Decided — PUT is a merge.** `PUT /appointments/{id}` updates only fields present in the body and leaves omitted fields unchanged. The admin body omits `clientId`, so the client stays. The caregiver cancel body is only `{ "appointmentStatus": "cancelled" }` and must not clear schedule, location, caregiver, or notes. Admin `notes: ""` is present and clears stored notes.

**Decided — detail `status` is unused.** The visit status is `appointmentStatus`. Detail `status` may be omitted or `""`. The admin app parses it and does not display or write it. Do not treat it as a second copy of `appointmentStatus`. List `status` on `GET /appointments` is the short name for the visit status and is separate from this detail field.

**Decided — list vs detail names.** `GET /appointments` rows use `status` and `type`. Admin detail uses `appointmentStatus` and `appointmentType`. The caregiver list model uses the detail names (`appointmentStatus`, `appointmentType`) because it parses caregiver-list rows with `AppointmentModel`. These are different paths. Keep the names different.

## Pagination

Admin appointment and caregiver lists expect `data.data` plus `data.meta` with `page`, `pageSize`, `total`, `totalPages`, `hasNextPage`, `hasPreviousPage`.

Caregiver `PaginationMetaModel` uses the same meta keys. **INFERRED** the caregiver list endpoints use that meta object. The commented call sites were not re-opened to quote every query parameter. Do not invent caregiver query keys here.

Admin client list is more tolerant (`clients` / `items` / `results`, `pagination` or `meta`, `total` or `totalCount`).

## Headers and content type

Both use JSON. Admin adds `X-Client`. Caregiver does not. Extra request headers are normally safe. **UNKNOWN** if a gateway rejects unknown `X-Client`.

Neither app uploads files on the paths above.

## What not to merge

- Do not point the admin client list at `/clients/caregiver/{id}`.
- Do not point the caregiver caseload at `GET /clients`.
- Do not rename `appointmentStatus` to `status` on the detail resource to “match” the admin list.
- Do not drop `serviceRequirements` or `completedToday` because one of the apps ignores them.
- Do not require `role` on login solely from the commented caregiver body without confirming the admin app still works without it.
