# 05 — Admin Business Workflows

Each workflow states the trigger, the rules the app enforces, the API it calls, and the status changes it can persist. Rules marked **CONFIRMED** are in source. Server-side rules beyond that are **UNKNOWN** unless noted as inferred.

## 1. Sign in as an admin

**Trigger.** Login screen submit.

**Validation (CONFIRMED).** Email required and must match the admin regex. Password required and may be any non-empty string. No password confirmation, no MFA.

**API.** `POST /auth/login`.

**Branch.** If `role` uppercased is not `ADMIN`, show access denied and keep the previous session untouched (nothing was saved). Otherwise store tokens and user, prefetch clients and appointments, open the dashboard.

**Failure.** `401` becomes a generic invalid-credentials message. The server’s login error text is not shown for 401.

## 2. Restore a session

**Trigger.** Cold start.

**Rule (CONFIRMED).** Splash uses the boolean flag only. API calls then require both the flag and an access token. Expired access tokens refresh automatically when a refresh token and an expiry timestamp exist.

**End states.** Dashboard, or login after a failed refresh plus `401`.

## 3. Sign out

**Trigger.** Dashboard logout confirmation.

**Effect (CONFIRMED).** Local tokens, user JSON, client list, and appointment list are cleared. Server session is unchanged. **INFERRED:** the refresh token remains valid until it expires or is revoked by some other means.

## 4. Read organization dashboard

**Trigger.** Home open, pull-to-refresh, or returning to home.

**API.** `GET /dashboard/stats` and `GET /clients?page=1&pageSize=50`.

**Displayed counts.** Total clients (stats, else list total, else loaded length). Today’s appointments from stats only (0 until loaded).

**Not a workflow.** The unused growth and caregiver counts are not acted on.

## 5. Find a client

**Trigger.** Clients search field.

**Rule.** 400 ms debounce. Empty search reloads from page 1 without `search` and continues until every matching page is loaded. Care-type filter does not hit the server. **Decided:** server `search` matches `firstName` or `lastName` only, ignores capital letters, and matches part of the word.

**Paging (decided).** The phone keeps the page size of 50 and requests the next page until every client is loaded. `total` is stored from the response.

## 6. Create a client

**Trigger.** Create Client submit.

**Validation (CONFIRMED).**

| Field | Rule |
|---|---|
| Full name | Required. Split on whitespace into `firstName` and `lastName`. A single token yields `lastName: ""`. |
| Date of birth | Required. Picker from year 1900 through today. Sent as `yyyy-MM-dd`. |
| Gender | Required by default `female`. Values `male`, `female`, `other`. |
| Phone | Required, non-empty. No format check. |
| Emergency name, relation, phone | Required, non-empty. |
| Primary condition, conditions, allergies, language, notes, address | Optional. Empty strings and empty arrays are still sent. |

**API.** `POST /clients`, then `GET /clients` if `data` is non-null.

**Not created in this step.** Hazards, service requirements, care plan, email, apartment.

**Decided.** The server stores emergency contact, diagnoses, language, notes, and address so that a later `GET /clients/{id}` returns them in the nested shapes in the models doc. Diagnosis rows come back with `notes` of exactly `Primary condition`, `Medical condition`, or `Allergy`.

## 7. Review a client

**Trigger.** Open client detail.

**API.** `GET /clients/{id}`.

**Derived display (CONFIRMED).** Age from `dateOfBirth`. Care type from the first service requirement category. Communication notes from client `notes`. Preferred language from `isPrimary` or the first language. Appointments embedded on the client, with caregiver first and last name.

## 8. Edit diagnoses

**Trigger.** Diagnosis sheet save.

**Validation.** No field is individually required; empty primary condition and empty lists are allowed. Values are trimmed. Blanks dropped from the lists.

**API.** `PUT /clients/{id}` shape A (full client flat body). The app rebuilds `primaryCondition`, `medicalConditions`, and `allergies` from the sheet and rebuilds every other field from the last GET.

**Status.** No client-status change.

## 9. Edit language

**Trigger.** Language sheet save.

**API.** Same PUT shape A. `language` and `communicationNote` change. Other diagnosis fields are reconstructed from cached diagnosis `notes` tags.

**Data loss risk (CONFIRMED).** Additional languages on the client are not included in the body. A server that replaces the language set with the single `language` string will drop them.

## 10. Edit directions and access

**Trigger.** Directions sheet save.

**Validation.** The sheet’s required-field behavior follows its text fields; the controller trims and sends whatever it is given, including empty strings.

**API.** `PUT /clients/{id}` shape B, including `email` and `status`.

**Preserved.** `address.apartment` from cache. **Not sent:** entry instructions, parking, latitude, longitude, address id.

**Status transition.** `status` is echoed, or set to `active` when the cache had none. **Decided:** the only values are `active` and `inactive`. The user cannot pick a status on the phone.

## 11. Maintain hazards

**Trigger.** Hazard sheet on the client, or the hazard section of the appointment editor.

**Scope (CONFIRMED).** Both UIs call `/clients/{clientId}/hazards`. An appointment does not own hazards in this app.

**Add and edit.** Description is required. Type is whichever section the user typed into. The body is `type` and `description` only. Edit is `PUT /clients/{clientId}/hazards/{hazardId}` after the user taps a hazard. The admin web portal can add and edit the same way.

**Delete.** `DELETE` by hazard id. Hazards that were never given an id cannot be deleted remotely.

## 12. Service requirements

**Trigger.** Service requirement sheet, and the service section of the appointment form.

**Validation in the sheet.** Category, frequency, and priority have defaults (non-medical, weekly, medium). Requirements are a local list.

**API.** None from the phone. **Decided:** the admin web portal creates and edits these rows. The phone shows them and does not save edits.

**Read model the server already returns.** `category`, `name`, `description`, `frequency`, `specialInstructions`, `isActive` on each requirement. The appointment form’s priority is not in that model.

**INFERRED.** Some other client created these rows. **Decided:** that client is the admin web portal. This phone cannot persist edits.

## 13. Create a care plan and add items

**Trigger.** Care plan sheet on client detail.

**Validation (CONFIRMED).** Name required. If both dates are set, end must not be before start. Status is one of `active`, `inactive`, `completed`.

**Create API.** `POST /care-plans` with `clientId`. Dates omitted when unset.

**Add item API.** One of:

- `POST /care-plans/{id}/tasks` — name, frequency, description
- `POST /care-plans/{id}/medications` — medicationName, dosage, schedule, description
- `POST /care-plans/{id}/diet` — meal, restrictions, description
- `POST /care-plans/{id}/hygiene` — activity, frequency, description

The sheet requires a title/name/meal/activity before calling these.

**Edit existing plan or item.** Local only on the phone once `carePlan.id` is non-empty. Completion checkbox is local only. Delete item is local only. **Decided:** the web portal can edit care-plan items. The phone does not.

**Cardinality (decided).** One care plan per client. `toClient()` uses `carePlans.first`. The server does not return a second plan.

**Status transition that is persisted.** Only the status sent at create time. Later status changes in the sheet do not reach the server.

## 14. List and search appointments

**Trigger.** Appointments screen.

**API.** `GET /appointments` with `page`, `pageSize=100`, optional `search`, repeated until `hasNextPage` is false.

**Local tabs.** Scheduled, completed, cancelled, using the collapsed status map. A server status of `confirmed` appears under Scheduled. `no_show` appears under Cancelled.

**Search target fields.** **Decided.** The client’s first or last name. Ignore capital letters and match part of the word. Caregiver name and visit type are not search fields.

## 15. Create an appointment

**Trigger.** Appointment form save when not editing.

**Validation (CONFIRMED).**

| Field | Rule |
|---|---|
| Client | Required |
| Caregiver | Required. Options from `GET /users/caregivers`. |
| Date, start, end | All required. End must be strictly after start on the same calendar day. Overnight visits are impossible in this form (`diff <= 0` is rejected). |
| Visit type | Optional. Empty string is sent if unset. Options from `GET /appointments/types`. |
| Instructions | Optional. |
| Location fields | Optional. Empty strings are sent. |

**API.** `POST /appointments`. No status field. **INFERRED** the server defaults the visit to a schedulable status. The local object is created as `scheduled`.

**Follow-up.** Dialog to open the editor for hazards and other visit details. Directions typed on the create form are sent as appointment location fields and also copied onto the in-memory client. They are not written with `PUT /clients/{id}` from this screen.

## 16. Update an appointment

**Trigger.** Edit form save.

**API.** `PUT /appointments/{id}` then `GET /appointments`.

**Status transition (CONFIRMED, persisted).** User may set `scheduled`, `completed`, or `cancelled` through `appointmentStatus`. There is no separate cancel-reason field. Check-in and check-out are displayed on the detail screen and are not editable here.

**Notes (CONFIRMED).** Create and update send the Notes field. `notes: ""` is sent only when that field is left blank, and that clears stored notes. `description` and `instructions` are both set from the instructions field.

**Not persisted from this form.** Priority, service requirements, safety instructions, client id changes.

## 17. Delete an appointment

**Trigger.** Trash icon on the edit form, then confirm.

**API.** `DELETE /appointments/{id}`. `404` is shown as not found. Success returns toward the appointments route. **Decided:** only the admin may call this. A caregiver cannot delete a visit. The phone does not read a `deletedAt` on a visit. A successful delete means that visit is gone.

## 18. Assign work to a caregiver

There is no separate assignment workflow. Assignment is `caregiverId` on appointment create and update. The caregiver list is read-only. The app does not set a caregiver’s auth role, permissions, or employment status.

## Status catalogs the backend must accept

| Entity | Values this app writes | Values this app reads beyond the write set |
|---|---|---|
| User role | none (not sent) | Must return `ADMIN` for this app to keep the session. Other roles are rejected locally. |
| Client `status` | echoed, or `active` | **Decided:** `active` or `inactive` only. Create omits `status` and the server defaults to `active`. |
| Client `gender` | `male`, `female`, `other` | Other strings display as female and would be rewritten as `female` on the next shape-A or shape-B PUT. |
| Appointment `appointmentStatus` | `scheduled`, `completed`, `cancelled` | `confirmed`, `in_progress`, `rescheduled`, `no_show`, `canceled` are read. `canceled` and `no_show` display as cancelled. |
| Appointment list `status` | not written on the list endpoint | Same `fromApi` map as above. |
| Care plan `status` | `active`, `inactive`, `completed` on create only | Any other string is kept and shown with a capitalized label, but the editor’s dropdown is the three known values. An unknown value can still be re-saved locally; it is not PUT. |
| Hazard `isActive` | `true` on create | `false` is parsed and still shown. |
| Diagnosis `isActive` | not written | Parsed, not filtered. |
| Service requirement `isActive` | not written | Parsed onto the local row. |

## Validation the app does not perform

Phone format, postal-code format, duplicate clients, caregiver availability, care-plan date vs appointment date, and permission checks. If the server enforces these, this app only surfaces them when the server returns `400` or `422` with a `message`. **Decided for overlap:** the phone still does not check. The server rejects a second visit for the same caregiver on the same day when the new start is before the other visit’s end. A start equal to that end time is allowed.
