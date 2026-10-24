# Senoria Seniors Admin — Mobile Rebuild Specification

This folder is a reverse-engineering record of the **admin Flutter app** in this repository (`senoria_seniors_admin`). It exists so a replacement backend API and a replacement admin web portal can be built without the original server or portal source.

The Flutter application was not modified to produce these documents.

## Scope

- **In scope:** every HTTP call, request body, response parser, auth rule, screen, and workflow that this admin app actually implements.
- **Out of scope:** implementing the backend or the web portal; redesigning JSON field names; treating missing mobile features as proof they never existed on the original web portal.

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| **CONFIRMED** | The admin app source sends, parses, or branches on this value. |
| **INFERRED** | A reasonable backend requirement follows from confirmed behavior, but the original schema is not in this repo. |
| **UNKNOWN** | The app does not establish the fact. Do not invent it. |

## How to read this pack

1. `01_admin_api_inventory.md` — the contract the new API must satisfy for this app to keep working.
2. `02_admin_request_response_models.md` — exact JSON names, types, and nullability.
3. `08_shared_api_contracts.md` — differences versus the sibling caregiver app, where that source was available.
4. `11_admin_open_questions.md` — what still blocks a complete backend and web portal.

Do **not** implement from `BACKEND_API_SPEC.md` at the repository root. That file is an older draft. It describes local dummy data, a suggested example base URL, and a `representative` role. The live client uses `https://api.senoriaseniors.com/api/v1`, camelCase JSON, and a client-side role check for `ADMIN`.

## Source of truth

| Item | Value | Evidence |
|---|---|---|
| App | Company Representative / admin mobile app | `pubspec.yaml` description; `AppStrings.appSubtitle` |
| State | GetX controllers | `lib/features/**/controllers` |
| HTTP | `ApiClient.instance` (GetConnect singleton) | `lib/shared/services/api/api_client.dart` |
| Base URL | `https://api.senoriaseniors.com` + `/api/v1` | `lib/shared/services/api/api_constants.dart` |
| Serialization | JSON object bodies, camelCase property names | request `toJson()` methods |
| Auth header | `Authorization: Bearer <accessToken>` | `ApiClient._buildHeaders` |

## Counts from this audit

| Item | Count | Notes |
|---|---|---|
| Endpoints actually called | **22** | Method + path. See inventory. |
| Endpoint helpers declared but never called | **0 new paths** | `clientHazardById` is used for DELETE only. A comment mentions PUT on the same path; no PUT call exists. `ApiClient.patch` has no caller. |
| Serializable model types | **44** | Classes with `toJson` or `fromJson`, including nested response objects. UI-only models such as `Client` and `CarePlan` are extra and are described in `02`. |
| Registered routes | **10** | `create-appointment` and `edit-appointment` share one screen widget. |
| Unique screen widgets | **9** | Plus bottom sheets that are not routes. |
| Unregistered route constant | **1** | `/edit-client` is declared and has no `GetPage`. |
| Administrative workflows | **18** | Documented in `05_admin_business_workflows.md`. |

## Document index

| File | Contents |
|---|---|
| `01_admin_api_inventory.md` | Every called endpoint: method, path, headers, query, body, success and error handling, caller, workflow. |
| `02_admin_request_response_models.md` | Models, enums, nullability, formats, and which fields the UI consumes. |
| `03_admin_authentication_permissions.md` | Login, refresh, storage, role gate, permissions, session end. |
| `04_admin_feature_inventory.md` | Screens and operations, with implementation status. |
| `05_admin_business_workflows.md` | Workflows, validation, and status transitions. |
| `06_admin_database_requirements.md` | Entities and relationships supported by the app. Not an original schema dump. |
| `07_admin_web_portal_requirements.md` | Portal scope that this app proves, and scope it cannot prove. |
| `08_shared_api_contracts.md` | Comparison with the sibling caregiver Flutter app. |
| `09_admin_api_fixtures.md` | Sanitized example payloads derived from serializers. |
| `10_admin_source_reference_map.md` | Files, classes, functions, and line numbers. |
| `11_admin_open_questions.md` | Gaps that must be resolved before a complete rebuild. |

## Implementation guidance

- Preserve JSON property names, nesting, and nullability. The admin app casts several fields with `as String` and will throw if they are missing or the wrong type.
- Treat IDs as opaque strings. The app does not require a UUID format. Local fallbacks such as `ap_<microseconds>` and `cl_<microseconds>` are client-only and must not be required from the server.
- Dates in **request bodies** are `yyyy-MM-dd`. Clock times in appointment bodies are 24-hour `HH:mm`. Response timestamps are parsed with `DateTime.tryParse` (ISO 8601). Appointment list/detail dates keep the UTC calendar day so a timezone does not shift the displayed date.
- Success responses are JSON objects. A raw JSON array is wrapped by the client as `{ "data": [ ... ] }` before parsers run.
- Any HTTP status from 200 through 299 is success. The app does not special-case 201 or 204.
- Authorize on the server. The app checks `role == ADMIN` (case-insensitive) only at login. It stores `permissions` and never consults them.
- Do not resolve caregiver-app conflicts by renaming admin fields. Conflicts are listed in `08_shared_api_contracts.md`.

## User-app documentation

This workspace does not contain a user-app reverse-engineering folder. A sibling caregiver app exists on disk at `Senoria Senors Caretaker/senoria_seniors_caretaker`. Its HTTP calls are commented out and replaced with demo data, but its endpoint constants, models, and commented request bodies are real source. `08_shared_api_contracts.md` uses that source. It does not use the caregiver repo’s `BACKEND_API_SPEC.md`, which proposes a different base URL and snake_case token names that the caregiver models do not parse.

## Final verification

| Check | Result |
|---|---|
| Every discovered call is documented | Yes. 22 calls, listed in `01` and cross-checked against `ApiEndpoints` and `ApiClient.instance` usages. |
| Request and response models reviewed | Yes. Every file under `lib/shared/models/` plus auth models. |
| Partial and inaccessible features identified | Yes. See `04`. |
| Uncertain response shapes identified | Yes. Create/update/delete calls that ignore the body, and list parsers that accept several envelopes. |
| Secrets included | No credentials, tokens, private keys, or passwords. The public API host from source is recorded because the client hardcodes it. |
