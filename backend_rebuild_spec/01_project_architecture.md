# 01 — Project Architecture

Status labels: **CONFIRMED** (present in this Flutter repo), **INFERRED** (required for the contract to work, not proven by a live server), **UNKNOWN** (not determined from source).

## 1. Independent codebases

```text
┌─────────────────────────┐     HTTPS JSON      ┌─────────────────────────┐
│ Flutter caregiver app   │ ──────────────────► │ Backend API             │
│ (this repository)       │ ◄────────────────── │ (new project)           │
│ package:http + GetX     │   /api/v1 envelope  │ auth, rules, database   │
└─────────────────────────┘                     └───────────▲─────────────┘
                                                            │ HTTPS JSON
                                                            │ admin routes
                                                ┌───────────┴─────────────┐
                                                │ Admin portal            │
                                                │ (new frontend project)  │
                                                │ no database driver      │
                                                └─────────────────────────┘
```

| Boundary | Decision | Status |
|---|---|---|
| Flutter stays a client | No server code is added to this repo in the rebuild | CONFIRMED requirement |
| Backend owns data | Mobile and admin never share a database connection | INFERRED requirement |
| Admin is a separate frontend | It must not import Flutter or query SQL | INFERRED requirement |
| Admin routes are new | This app contains no admin endpoints | CONFIRMED |

## 2. Mobile stack (CONFIRMED)

| Concern | Implementation |
|---|---|
| UI | Flutter, portrait only |
| State and routing | GetX (`GetxController`, `Obx`, `GetPage`) |
| HTTP | `package:http` via singleton `ApiClient.instance` |
| Token storage | `GetStorage` box `auth_box` |
| Location | `geolocator`, used only for care-plan check-in |
| JSON | `dart:convert`. No `json_serializable`, Retrofit, or Dio |

There is no repository layer. Controllers and one view call `ApiClient` directly. Those calls are commented and currently read `DemoData`.

## 3. Request path (CONFIRMED)

`ApiClient._send` (`lib/services/api/api_client.dart`):

1. Build `Uri.parse(ApiConstants.apiBaseUrl + endpoint)`.
2. Attach query parameters with `value.toString()`. Null becomes `""`.
3. Set `Content-Type` and `Accept` to `application/json`.
4. If `requiresAuth` is true and an access token exists, set `Authorization: Bearer <token>`.
5. `jsonEncode` the body. There is no multipart method.
6. Dispatch GET, POST, PUT, PATCH, or DELETE. Timeout is 30 seconds.
7. Decode the body as a JSON object. An empty body becomes `{}`. A JSON array or other non-object also becomes `{}` because the cast fails. On HTTP 2xx the client then returns `data`, which is null. Callers treat that null as an empty list, an empty page, or a generic parse error. It is not an HTTP failure.
8. On HTTP 200–299, return `json['data']` only. `message` and `code` are read first and must be strings, null, or absent. A non-string `message` or `code` throws before `data` is returned, and the caller sees a generic `ApiException`.
9. On 401 for an authenticated call that is not `/auth/refresh`, call refresh once and retry the original request once.

**CONFIRMED:** the client does not read a `success` boolean. HTTP status decides success.

**CONFIRMED:** refresh is a direct `http.post`, not `ApiClient.post`, and it sends no Authorization header.

## 4. Base URL (CONFIRMED)

From `lib/services/api/api_constants.dart`:

| Piece | Value |
|---|---|
| Host | `https://api.senoriaseniors.com` |
| Version prefix | `/api/v1` |
| Full prefix | `https://api.senoriaseniors.com/api/v1` |
| Timeout | 30 seconds |

The replacement server can use any host. The app will point `baseUrl` at it. Paths stay `/api/v1/...`.

## 5. Authentication boundary (CONFIRMED)

| Item | Behavior |
|---|---|
| Login | `POST /auth/login`, `requiresAuth: false`, body includes `role: "CAREGIVER"` |
| Session | Access token, refresh token, and user JSON in GetStorage |
| User id | `user.id` string, read as `TokenStorageService.userId` and placed in the URL |
| Expiry | `expiresIn` is parsed and then discarded. The app refreshes only after HTTP 401 |
| Logout | Clears the local box. The `/auth/logout` path constant is never called. Its HTTP method is unknown |
| Role gate | After parsing login `data`, role must equal `CAREGIVER` case-insensitively |

**DECIDED (2026-10-19):** the access token is a JWT with a 24-hour lifetime. `expiresIn` is `86400`. The refresh token is an opaque string, lasts 30 days, and is replaced on every successful refresh. The app still stores both as strings and does not read `exp`. Admins do not use this login. They authenticate in the separate admin application, and an admin sets the caregiver password.

## 6. Data boundary (INFERRED)

The mobile app is read-heavy. Writes are limited to:

- care-plan check-in (UTC `timestamp`, `location.latitude`, `location.longitude`, local `date`). The current body does not include `appointmentId`
- care-plan item completion toggle (`itemType`, `itemId`, `date`). A second call flips `completed`
- daily visit completion (`date` only). A repeat for the same appointment and date stays completed
- appointment cancel. The current commented body is only `appointmentStatus: "cancelled"`. The decided rule also requires `cancellationReason`, which this body does not send

Everything else (clients, care plans, diagnoses, appointments, assignments) must be created by the admin portal or by seed data. The caregiver app has no create/update/delete for those entities.

`completedToday`, `activeToday`, and `dailyVisitStatus` are returned by the server and displayed as-is. The phone does not compute them from the schedule, except for local demo mutations. **DECIDED:** those two bools use the `X-Timezone` header when it is a valid IANA name, and `America/Vancouver` when the header is missing or invalid. This app does not send the header. Check-in sets `checkInTime` and leaves `dailyVisitStatus` as `pending`.

## 7. Deployment boundaries (proposal)

| Service | Exposes | Does not expose |
|---|---|---|
| API | `/api/v1` caregiver contract, plus a separate `/api/v1/admin/...` (or equivalent) for the portal | Database port, Flutter assets |
| Admin portal | Static web app | SQL, the Flutter project |
| Database | Private network to the API only | Public internet, either frontend |

**DECIDED:** caregiver tokens must not authorize admin mutations. Admin role is `ADMIN`. Admins sign in only through the separate admin application, on `/api/v1/admin`. Caregiver `POST /auth/login` accepts `role: "CAREGIVER"` only. The mobile login body always sends that role.

## 8. Integration strategy

1. Build the API in a new repository using `02`, `03`, `04`, `05`, and `11`.
2. Contract-test every fixture in `11` before touching Flutter.
3. Change `ApiConstants.baseUrl`.
4. Uncomment each `SERVER_DOWN` block and delete the matching `DemoData` line. That edit is required for the phone to use the network. It does not change the request bodies. The list is in `10_open_questions_and_assumptions.md`.
5. Add `cancellationReason` to the cancel PUT. The server requires it, and the current commented body does not send it. There is no safe server-side substitute. Do not add `X-Timezone`; a missing header means `America/Vancouver`. Check-in may omit `appointmentId` only while the unique-visit fallback in file 10 applies.
6. Build the admin portal against new admin endpoints after the caregiver checklist in `09` passes. The first admin release includes an audit log and visit history, and does not export reports.

## 9. What not to import from this repo

| Path | Why |
|---|---|
| `lib/shared/models/` | Unused legacy UI models. No `fromJson`. Not the API |
| `lib/services/demo_data.dart` | Sample data and local mutations. Useful as a fixture source, not as a server |
| `lib/core/theme/` | Colors and copy only |

Use `lib/models/` and `lib/services/api/` as the contract source of truth.
