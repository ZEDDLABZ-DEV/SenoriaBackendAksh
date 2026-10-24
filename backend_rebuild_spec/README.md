# Senoria Caregiver — Backend and Admin Portal Rebuild Specification

This folder is a reverse-engineered contract for the existing Flutter caregiver app in this repository. It exists so a new, separate Cursor project can rebuild the API server and a separate admin portal without the old backend source.

The Flutter app is the compatibility baseline. The replacement API must accept the same methods, paths, headers, bodies, and JSON field names the app already parses. The intended mobile change is the API base URL, plus uncommenting the calls that are currently replaced by demo data. Two further client gaps are recorded in `10_open_questions_and_assumptions.md`: cancel does not send `cancellationReason`, and check-in does not send `appointmentId`. The timezone header is not sent; the server falls back to `America/Vancouver`.

## Project overview

**App name:** Senoria Caregiver (`senoria_seniors_caretaker`)

**Audience:** caregivers. Login sends a hardcoded role of `CAREGIVER`. Any other role is rejected after a successful login response.

**What the app does:** sign in, list assigned appointments, list assigned clients with search and paging, open a client profile, open an appointment, check in to a care plan with device location, toggle care-plan checklist items, mark a visit complete for a chosen date, and cancel an appointment.

**What the app does not do:** registration, file upload, push notifications, payments, reports, or any admin screen. Logout is local only. The Forgot password button does nothing.

**Current runtime state (CONFIRMED):** almost every HTTP call is commented out and replaced by `lib/services/demo_data.dart`. The contract in this folder comes from those commented calls, the `fromJson` parsers, and the demo JSON shapes. It was not captured from a live server. Each finding is marked **CONFIRMED**, **INFERRED**, or **UNKNOWN**.

**Configured base URL (CONFIRMED):** `https://api.senoriaseniors.com/api/v1`

No `.env` file and no credentials were found in the app. This documentation does not include passwords, tokens, or personal data.

## Three independent codebases

| Codebase | Role | Rule |
|---|---|---|
| This Flutter app | Caregiver mobile client | Change the base URL, uncomment the existing calls, and add `cancellationReason` on cancel. Check-in `appointmentId` is required only when two scheduled visits for the same client overlap that date. Do not add `X-Timezone` for the current app |
| Backend API project | Auth, business rules, database | Must reproduce this contract. No Flutter code in this project |
| Admin portal project | Staff UI | Separate frontend. Talks to the API only. No direct database access and no Flutter coupling |

## Compatibility requirements

Preserve, wherever the Flutter client establishes them:

1. HTTP methods and relative paths under `/api/v1`.
2. Request parameter names and body field names.
3. `Content-Type: application/json` and `Accept: application/json`.
4. `Authorization: Bearer <accessToken>` on authenticated calls.
5. The `{ message, data }` success envelope. `ApiClient` returns only `data` on HTTP 2xx.
6. Error object shape: `message`, optional `code`, optional `errors`.
7. String `id` values. Do not send `_id` or numeric ids.
8. The clients-list double nest: outer `data` contains `{ data, meta }`.
9. The appointments-list shape: outer `data` is an array, with no pagination.
10. Separate `appointmentStatus` and `status` fields.
11. Date strings the app can parse with `DateTime.tryParse`, and request dates as `YYYY-MM-DD`.
12. Status spellings the UI already branches on (`scheduled`, `cancelled`, `pending`, `in_progress`, and the others listed in `03_data_models.md`).

Do not redesign the API because another shape would be cleaner.

## Document index

| File | Contents |
|---|---|
| `01_project_architecture.md` | Codebases, request flow, auth, data, deployment boundaries |
| `02_api_inventory.md` | All 13 endpoints, with callers and schemas |
| `03_data_models.md` | Every Dart model and the JSON it parses |
| `04_authentication_and_permissions.md` | Login, refresh, storage, roles, failure behavior |
| `05_database_schema.md` | Proposed tables. Assumptions are labeled |
| `06_mobile_feature_workflows.md` | Screens, workflows, and business rules |
| `07_admin_portal_specification.md` | Proposed admin modules tied to real mobile data |
| `08_implementation_plan.md` | Phased build order, dependencies, acceptance tests |
| `09_api_compatibility_checklist.md` | Regression checklist before pointing the app at the new API |
| `10_open_questions_and_assumptions.md` | Facts, assumptions, and justified Flutter changes |
| `11_api_contract_fixtures.md` | Sanitized request and response examples |
| `12_source_code_reference_map.md` | File, class, and line map back into this repo |

## Recommended implementation order

1. Read `02`, `03`, `04`, and `11` before writing any server code.
2. Implement auth (`login`, `refresh`) and the standard envelope.
3. Implement read endpoints: appointments by caregiver, appointment by id, clients by caregiver, client by id.
4. Implement visit writes: care-plan check-in, care-plan item toggle, daily completion, appointment cancel.
5. Seed one caregiver, at least two active clients, one appointment for today with `dailyVisitStatus: "pending"`, and one future appointment.
6. Run `09_api_compatibility_checklist.md` against the Flutter parsers (contract tests are enough before uncommenting the app).
7. Change `ApiConstants.baseUrl`, uncomment the `SERVER_DOWN` call sites, remove `DemoData` usage, and add `cancellationReason` to the cancel body. Do not add `X-Timezone`. Add check-in `appointmentId` only if overlapping visits must be distinguishable.
8. Build the admin portal from `07` only after the caregiver API passes the checklist. Admin endpoints are new. They are not part of the mobile contract.

## Audit scope

Reviewed: all 61 Dart files under `lib/`, `pubspec.yaml`, and a search for environment files. Networking uses `package:http` through `ApiClient`. State management is GetX. Unused legacy models in `lib/shared/models/` are not the API contract.

**Endpoints found:** 13. Ten have call sites (nine commented, plus live refresh). Three path constants have no caller, so their HTTP methods are unknown.

**Response models reviewed:** 19.

**Decisions incorporated on 2026-10-19:** caregiver scope is 404; checklist items toggle; daily completion does not undo; check-in sets `checkInTime` and leaves `dailyVisitStatus` as `pending`; access tokens are 24-hour JWTs; refresh tokens are opaque, last 30 days, and rotate; admins use a separate app and set caregiver passwords; v1 admin includes audit logs and visit history and does not export reports; closed lists include severity and proficiency, and `other` is shown as "Other" without the admin note.

**Still absent from the caregiver app:** logout, forgot-password, and reset-password calls. Caregiver v1 does not implement them. An admin sets the caregiver password. Details and the Flutter request comparison are in `10_open_questions_and_assumptions.md`.
