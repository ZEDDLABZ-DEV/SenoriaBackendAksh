# 05 — Proposed Database Schema

This schema is the new database. It was proposed from Dart models, request bodies, and screen behavior, then confirmed as the schema to build. It is not a copy of an old production database. Column names here are storage names. JSON names in `03_data_models.md` stay camelCase on the wire even if columns are snake_case.

**DECIDED:** primary keys are string UUIDs. JSON `id` is that UUID string. Integer keys serialized as JSON numbers will crash the app.

**DECIDED:** no soft delete and no `deleted_at`. Use `status` of `active` or `inactive` on users, clients, care plans, and the appointment record `status`. Rows that must be kept are inactivated, not deleted.

Timestamps `created_at` and `updated_at` are **INFERRED** operational columns. The mobile JSON does not read them.

## Entity relationship

```text
users (caregivers and, later, admins)
  │
  ├──< refresh_tokens
  ├──< user_permissions
  │
  └──< caregiver_client_assignments >── clients
                                          │
                                          ├──< client_languages          (no API id)
                                          ├──< emergency_contacts        (no API id)
                                          ├──< diagnoses
                                          ├──< client_hazards            (no API id)
                                          ├──< service_requirements
                                          ├──< care_plans
                                          │       ├──< care_plan_goals
                                          │       ├──< care_tasks ──────────────┐
                                          │       ├──< care_medications ─────────┤
                                          │       ├──< care_diet_instructions ───┤
                                          │       └──< care_hygiene_instructions ┤
                                          │                                      │
                                          └──< appointments                       │
                                                  │                              │
                                                  ├──< appointment_daily_visits  │
                                                  └── optional care_plan_id ─────┘
                                                                                │
                                          care_item_completions (item_type, item_id, date)
                                          care_plan_check_ins

admin actions ── audit_log
```

## `users`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | string PK | no | JSON `id` |
| `email` | string | no | Unique, case-insensitive |
| `password_hash` | string | no | Never in JSON |
| `first_name` | string | no | JSON `firstName` |
| `last_name` | string | no | JSON `lastName` |
| `role` | string | no | `CAREGIVER` or `ADMIN`. Admins sign in only in the admin app |
| `avatar` | string | yes | JSON `avatar` |
| `phone` | string | yes | Used when this user is embedded as `caregiver` on an appointment. Not on `UserModel` |
| `status` | string | no | Proposal: `active`. Login should fail for inactive users with 401 |
| `created_at` | timestamptz | no | Proposal |
| `updated_at` | timestamptz | no | Proposal |

Unique: `email`.

The appointment embed `AppointmentCaregiverModel` has phone and email and no id. Those can be copied from `users` at read time.

## `refresh_tokens`

Required because refresh exists. **DECIDED:** the refresh token is an opaque random string. Store only its hash. Return the raw value once. Lifetime is 30 days. Every successful refresh inserts a new row and sets `revoked_at` on the previous row. Presenting a revoked or expired hash returns 401.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | string PK | no | |
| `user_id` | string FK → users.id | no | |
| `token_hash` | string | no | Store a hash, return the raw token once |
| `expires_at` | timestamptz | no | 30 days from issue |
| `revoked_at` | timestamptz | yes | Set when rotated or when the user is deactivated |
| `created_at` | timestamptz | no | |

Index: `token_hash`, `user_id`.

Access tokens are JWTs signed by the server. They last 24 hours. They are not rows in this table. `expiresIn` in the JSON is `86400`.

## `user_permissions`

**DECIDED:** caregiver and admin v1 do not use named permissions. Login returns `permissions: []`. This table can stay empty. Do not invent permission strings.

| Column | Type | Null |
|---|---|---|
| `user_id` | string FK | no |
| `permission` | string | no |

Unique: (`user_id`, `permission`).

## `clients`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | `id` |
| `first_name` | string | no | `firstName` |
| `last_name` | string | no | `lastName` |
| `date_of_birth` | date | yes | `dateOfBirth` |
| `gender` | string | no | `gender`. **DECIDED:** `female`, `male`, `other` |
| `phone` | string | no | `phone` |
| `email` | string | yes | `email` |
| `profile_image` | string | yes | `profileImage` |
| `notes` | text | no | `notes`. Default `""` |
| `status` | string | no | `status`. Mobile list always asks for `active` |
| `address_street` | string | no | `address.street` |
| `address_apartment` | string | no | `address.apartment`. Default `""` |
| `address_city` | string | no | `address.city` |
| `address_state` | string | no | `address.state` |
| `address_zip_code` | string | no | `address.zipCode` |
| `address_country` | string | no | `address.country` |
| `gate_access_code` | string | no | `address.gateAccessCode`. Default `""` |
| `navigation_instructions` | text | no | `address.navigationInstructions` |
| `gender_other_note` | text | yes | Admin only, when `gender` is `other`. Omit from caregiver JSON |
| `created_at` / `updated_at` | timestamptz | no | Not in JSON |

Index: `status`, (`last_name`, `first_name`).

## `caregiver_client_assignments`

**DECIDED:** many caregivers can be assigned to one client. A caregiver API still returns only that caregiver's assignments. Another caregiver's client id returns 404.

| Column | Type | Null |
|---|---|---|
| `id` | string PK | no |
| `caregiver_id` | string FK → users.id | no |
| `client_id` | string FK → clients.id | no |
| `created_at` | timestamptz | no |

Unique: (`caregiver_id`, `client_id`). Index both foreign keys.

## `client_languages`

No id in the API. Surrogate key is fine if it is not required in JSON.

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | omit from JSON |
| `client_id` | string FK | no | |
| `name` | string | no | `name` |
| `proficiency` | string | no | `proficiency`. **DECIDED:** `native`, `fluent`, `intermediate`, `basic`, `other` |
| `proficiency_other_note` | text | yes | Admin only, when `proficiency` is `other`. Omit from caregiver JSON |
| `is_primary` | bool | no | `isPrimary` |
| `sort_order` | int | no | omit. Proposal for stable order |

## `emergency_contacts`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | omit |
| `client_id` | string FK | no | |
| `name` | string | no | `name` |
| `relationship` | string | no | `relationship` |
| `phone` | string | no | `phone` |
| `email` | string | yes | `email` |
| `is_primary` | bool | no | `isPrimary` |
| `sort_order` | int | no | omit |

## `diagnoses`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | `id` |
| `client_id` | string FK | no | |
| `name` | string | no | `name` |
| `icd_code` | string | yes | `icdCode` |
| `diagnosed_date` | date | yes | `diagnosedDate` |
| `severity` | string | yes | `severity`. **DECIDED when set:** `low`, `moderate`, `high`, `other` |
| `severity_other_note` | text | yes | Admin only, when `severity` is `other`. Omit from caregiver JSON |
| `notes` | text | no | `notes`. This is the diagnosis note the caregiver app already parses. It is not the `other` note |
| `is_active` | bool | no | `isActive`. Parser default true |

**DECIDED:** allergies are rows in this table. There is no separate allergies list and no Flutter change. The UI label "Diagnoses & Allergies" does not imply a second entity.

## `client_hazards`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | omit |
| `client_id` | string FK | no | |
| `type` | string | no | `type`. **DECIDED:** `fall_risk`, `other` |
| `type_other_note` | text | yes | Admin only, when `type` is `other`. Omit from caregiver JSON |
| `description` | text | no | `description` |
| `severity` | string | no | `severity`. **DECIDED:** `low`, `moderate`, `high`, `other` |
| `severity_other_note` | text | yes | Admin only, when `severity` is `other`. Omit from caregiver JSON |
| `precautions` | text | no | `precautions` |
| `is_active` | bool | no | `isActive` |

## `service_requirements`

Shown on the appointment payload, not on `ClientModel`. Store them on the client and embed them when building an appointment's `client` object.

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | `id` |
| `client_id` | string FK | no | |
| `service` | string | no | `service` |
| `start_on` | date | yes | JSON `startTime` (date string in the demo) |
| `end_on` | date | yes | JSON `endTime` |

**DECIDED:** `start_on` and `end_on` are calendar dates, serialized as `YYYY-MM-DD` in JSON `startTime` and `endTime`. They are not clock times.

## `care_plans`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | `id` |
| `client_id` | string FK | no | |
| `name` | string | no | `name` |
| `description` | text | no | `description` |
| `status` | string | no | `status` |
| `notes` | text | no | `notes` |
| `start_date` | date | yes | `startDate` |
| `end_date` | date | yes | `endDate` |

## `care_plan_goals`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | omit. API is a string array |
| `care_plan_id` | string FK | no | |
| `text` | text | no | element of `goals` |
| `sort_order` | int | no | |

## Care plan item tables

Shared shape: string `id`, FK `care_plan_id`, text fields, no `completed_today` column. Completion is per date in `care_item_completions`. When serializing, set `completedToday` from the completion row for the relevant date.

**DECIDED date rule:** read endpoints do not receive a date query. Compute `completedToday` and `activeToday` for the current calendar day in the request's `X-Timezone` header. If that header is missing or not a valid IANA name, use `America/Vancouver`. This caregiver app does not send the header, so its reads use Vancouver. The toggle body still sends the device's local `date`. A second toggle flips `completed`. Do not infer the zone from a UTC timestamp.

### `care_tasks`

`id`, `care_plan_id`, `name`, `frequency`, `description`, `sort_order`.

### `care_medications`

`id`, `care_plan_id`, `medication_name`, `dosage`, `schedule`, `description`, `sort_order`.

JSON `medicationName` and `schedule`.

### `care_diet_instructions`

`id`, `care_plan_id`, `meal`, `restrictions`, `description`, `sort_order`.

### `care_hygiene_instructions`

`id`, `care_plan_id`, `activity`, `frequency`, `description`, `sort_order`.

## `care_item_completions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | string PK | no | Not returned except via `completedToday` |
| `care_plan_id` | string FK | no | |
| `item_type` | string | no | `task`, `medication`, `diet`, `hygiene` |
| `item_id` | string | no | |
| `service_date` | date | no | Request field `date` |
| `completed` | bool | no | JSON `completed` on toggle, and `completedToday` on reads |
| `caregiver_id` | string FK | no | Token subject |
| `created_at` / `updated_at` | timestamptz | no | |

Unique: (`item_type`, `item_id`, `service_date`). **DECIDED:** toggle flips `completed` inside a transaction. Daily completion is a different table and does not flip back.

Check constraint: `item_type` in the four strings above. The item id must belong to `care_plan_id`. **INFERRED.**

## `appointments`

| Column | Type | Null | JSON |
|---|---|---|---|
| `id` | string PK | no | `id` |
| `client_id` | string FK | no | `clientId` |
| `caregiver_id` | string FK → users.id | no | `caregiverId` |
| `care_plan_id` | string FK | yes | `carePlanId` |
| `description` | text | no | `description` |
| `scheduled_date` | date | yes | `scheduledDate` |
| `end_date` | date | yes | `endDate` |
| `start_time` | string | no | `startTime` `HH:mm` |
| `end_time` | string | no | `endTime` |
| `duration_minutes` | int | no | `duration` |
| `appointment_type` | string | no | `appointmentType`. **DECIDED:** `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other` |
| `appointment_type_other_note` | text | yes | Admin only, when `appointment_type` is `other`. Omit from caregiver JSON |
| `appointment_status` | string | no | `appointmentStatus`. **DECIDED:** `scheduled`, `completed`, or `cancelled` |
| `record_status` | string | no | JSON `status`. **DECIDED:** `active` or `inactive` only. Not the visit state |
| `instructions` | text | no | `instructions` |
| `notes` | text | no | `notes` |
| `cancellation_reason` | text | yes | `cancellationReason`. **DECIDED:** required and non-empty when `appointment_status` is `cancelled`. The current caregiver body does not send it; that request is 422 |
| `location_street` | string | no | `locationStreet` |
| `location_city` | string | no | `locationCity` |
| `location_state` | string | no | `locationState` |
| `location_zip_code` | string | no | `locationZipCode` |
| `location_gate_code` | string | yes | `locationGateCode`. **DECIDED:** always return it, including on future visits. The app hides it until the visit day |
| `location_navigation` | text | no | `locationNavigation` |
| `created_at` / `updated_at` | timestamptz | no | Not in JSON |

Index: (`caregiver_id`, `scheduled_date`), (`client_id`, `scheduled_date`), `appointment_status`.

**Proposal:** copy location defaults from the client address when an admin creates the appointment, and allow overrides. The JSON is flat on the appointment even when the client address is nested.

`checkInTime` and `checkOutTime` are not stored on this row in this proposal. They come from the daily visit row for "today" (or the latest visit). Demo sets them on the appointment object the list returns, so the API must still emit them on `AppointmentModel`.

## `appointment_daily_visits`

**Proposal requiring verification.** The list returns per-day flags without a date query, and completion posts a `date`. A multi-day appointment can stay `scheduled` while today is `pending` or `completed`. That needs one row per appointment per calendar date, created lazily or pre-generated from `scheduled_date` through `end_date`.

| Column | Type | Null | JSON on the appointment |
|---|---|---|---|
| `id` | string PK | no | omit |
| `appointment_id` | string FK | no | |
| `service_date` | date | no | |
| `daily_visit_status` | string | no | `dailyVisitStatus` |
| `completed` | bool | no | `completedToday` when `service_date` is the response's today |
| `active` | bool | no | `activeToday` |
| `check_in_at` | timestamptz | yes | `checkInTime` ISO string |
| `check_out_at` | timestamptz | yes | `checkOutTime` |
| `cancellation_reason` | text | yes | Optional copy onto the appointment when this day is cancelled |

Unique: (`appointment_id`, `service_date`).

**DECIDED status transitions for the row that matches "today":**

| Event | `daily_visit_status` | `completed` | `active` | Times |
|---|---|---|---|---|
| Visit day is today and nothing has happened | `pending` | false | true | null |
| Visit day is not today | `pending` | false | false | null |
| Check-in | stays `pending` | false | true | `check_in_at` set. Do not set `in_progress` |
| Daily completion, first call | `completed` | true | false | `check_out_at` set |
| Daily completion, same appointment and date again | stays `completed` | stays true | false | unchanged |
| Cancel | `cancelled` | false | false | appointment `cancellation_reason` required |

"Today" is the current date in `X-Timezone`, or `America/Vancouver` when the header is absent. Future days stay `activeToday: false` so the app locks the gate code and the checklist. The gate code is still returned.

**DECIDED:** `completedToday` is true only for the device's current day under that timezone rule. A visit finished on an earlier day returns `completedToday: false` and `dailyVisitStatus: "completed"`. The dashboard chip says "Completed today" whenever the bool is true, so a historical row must not send `true`. Completing one day does not set `appointment_status` to `completed`. It stays `scheduled` until every day in `scheduled_date` through `end_date` is completed, or an admin marks the whole appointment completed.

`DemoData.markCheckedIn` sets `dailyVisitStatus` to `in_progress`, and `DemoData` sets `completedToday: true` on a past visit. Those sample mutations are not the server rules.

## `care_plan_check_ins`

The phone posts check-in per care plan and does not read the rows back. Store them for the admin monitor and for server-side rules.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | string PK | no | |
| `care_plan_id` | string FK | no | |
| `appointment_id` | string FK | no | Set from body `appointmentId` when present. The current app omits it. Then set it only when exactly one of this caregiver's `scheduled`, `active` appointments for the care plan's client covers `service_date`. Otherwise reject the request and insert nothing |
| `caregiver_id` | string FK | no | Token subject |
| `checked_in_at` | timestamptz | no | Request `timestamp` |
| `service_date` | date | no | Request `date` |
| `latitude` | number | no | |
| `longitude` | number | no | |

**DECIDED transaction:** insert the check-in and set that date's `check_in_at` if still null. Leave `daily_visit_status` as `pending`. Reject when the appointment is cancelled, the date is outside the scheduled range, the caregiver is not assigned (404), or the appointment cannot be identified uniquely (422). Check-in is allowed for any care plan on that client. `appointments.care_plan_id` does not limit which plans can be checked in.

## Doctor fields

`ClientAppointmentModel` doctor columns are not a separate table in the parser. Proposal: nullable columns on `appointments`:

| Column | JSON |
|---|---|
| `doctor_name` | `doctorName` |
| `doctor_specialty` | `doctorSpecialty` |
| `doctor_phone` | `doctorPhone` |
| `clinic_name` | `clinicName` |

Include them on client-profile appointment summaries when `appointment_type` is `doctor_visit`. They are not read on `AppointmentModel`, so the caregiver appointment list can omit them.

## Transactional rules (INFERRED)

| Operation | Must be atomic |
|---|---|
| Toggle item | Flip one completion row. Return `{ completed: <bool> }` |
| Check-in | Insert check-in. Set `check_in_at`. Leave `daily_visit_status` as `pending`. Return the full appointment |
| Complete day | Set that day's visit completed and `check_out_at`. A repeat stays completed. Response is the small completion record, not the appointment. Leave `appointment_status` as `scheduled` until every day is done or an admin completes the appointment |
| Cancel | Require `cancellation_reason`. Set `appointment_status` to `cancelled`. Set the daily visit to `cancelled`. Reject any other `appointmentStatus`. Return the full appointment |
| Login | Write the refresh-token hash and return the user, a 24-hour JWT, the opaque refresh token, and `expiresIn: 86400` |

## Indexes (proposal)

| Table | Index |
|---|---|
| `users` | unique lower(email) |
| `caregiver_client_assignments` | unique (caregiver_id, client_id) |
| `appointments` | (caregiver_id, scheduled_date), (client_id) |
| `appointment_daily_visits` | unique (appointment_id, service_date) |
| `care_item_completions` | unique (item_type, item_id, service_date) |
| `clients` | (status), (last_name, first_name) |

## `audit_log`

**DECIDED for the first admin release.** The caregiver app does not read this table. Record admin changes only. Visit history is not a second log: it is the existing check-in, checklist, daily-visit, and cancellation rows.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | string PK | no | |
| `actor_user_id` | string FK → users.id | no | The admin |
| `action` | string | no | For example `create`, `update`, `assign`, `deactivate`, `set_password` |
| `entity_type` | string | no | |
| `entity_id` | string | no | |
| `created_at` | timestamptz | no | |

Do not add an export or report table. Dashboard counts are queries, not stored reports.

## Explicit non-goals

| Item | Why it is absent |
|---|---|
| File/blob table | No upload API. `profileImage` and `avatar` are optional URL strings |
| Notification device tokens | No messaging code |
| Payments | No payment models |
| Soft delete | Decided against. Use `active` / `inactive` |
| Exported report tables | Decided out of the first admin release |
| `_id` Mongo keys | The client requires `id` |
| Caregiver-visible `other` note | Stored on the row and omitted from caregiver JSON |
