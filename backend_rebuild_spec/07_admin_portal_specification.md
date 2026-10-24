# 07 — Admin Portal Specification

The Flutter app has no admin screens and no admin endpoints. This document is a **proposal** for a separate frontend. Every module below exists so staff can create data the caregiver API already returns, or so staff can see writes the caregiver app already performs.

Rules:

- Separate repository and deployable.
- Talks to the backend over HTTPS JSON only.
- No Flutter imports and no database driver.
- Caregiver bearer tokens must not access these operations.
- New admin routes are allowed. They must not change the 13 caregiver paths.
- Fields and enums staff edit must serialize to the names in `03_data_models.md` when the caregiver app reads them.

**DECIDED** admin role: `ADMIN`. No other admin roles in v1. Admins authenticate only in this application. They do not use the caregiver app. Caregiver `POST /auth/login` accepts `role: "CAREGIVER"` only.

**DECIDED** URL prefix: `/api/v1/admin/...`. That prefix is not part of the mobile contract.

## Authentication

| Screen | Behavior |
|---|---|
| Login | Email and password on `POST /api/v1/admin/auth/login`. Server checks `role` is `ADMIN`. Do not accept an admin on caregiver `POST /auth/login` |
| Session | Bearer JWT, 24 hours, `expiresIn: 86400`. Refresh reuses `POST /auth/refresh`. The refresh token is opaque, lasts 30 days, and rotates |
| Logout | Clear local storage. Caregiver logout stays local and is a separate rule |
| Forbidden | Caregiver tokens receive 404 or 403 on admin routes. Prefer 403 here, because the admin prefix is not a hidden caregiver resource. Caregiver data hiding stays 404 on the caregiver API |
| Caregiver passwords | An admin sets or resets the caregiver password. There is no caregiver email or OTP reset |

Staff accounts are also created by an admin. There is no self-service staff reset in v1.

## Dashboard

**Proposal, tied to real entities.**

| Widget | Source |
|---|---|
| Active caregivers | `users` where role is caregiver and status is active |
| Active clients | `clients.status = active` |
| Today's visits | `appointment_daily_visits` for today, grouped by `daily_visit_status` |
| Checked-in now | today's visits with `check_in_at` set and `daily_visit_status` still `pending` |
| Completed today | visits completed for today |
| Cancelled today | visits cancelled for today |

Read-only counts. **DECIDED:** the first admin release has these counts, an audit log, and visit history. It does not include charts or exported reports. "Today" on this dashboard uses `America/Vancouver` unless the admin request sends a valid `X-Timezone`.

## Caregivers

Needed because login and both list endpoints are caregiver-scoped.

| Screen | Operations | Validation |
|---|---|---|
| List | Search by name and email, filter status, paginate | |
| Create | first name, last name, email, phone, password, status | Email unique. Password at least 6 characters so the mobile validator accepts it. Role forced to `CAREGIVER`. The admin sets this password |
| Edit | Same fields. Password is optional and, when set, replaces the hash | This is how an admin resets a caregiver password |
| Deactivate | Sets status so login returns 401 | Do not delete if assignments or appointments exist |

The mobile `UserModel` does not include phone. Phone is still required so appointment embeds can return `caregiver.phone`.

Permissions editor: do not build one in v1. Login `permissions` is always `[]`. The admin gate is the `ADMIN` role.

## Clients

Needed for both client endpoints and for the appointment embed.

| Screen | Fields |
|---|---|
| List | Name, status, phone, assigned caregivers. Search by name. Filter status. Paginate |
| Create / edit | `firstName`, `lastName`, `dateOfBirth`, `gender`, `phone`, `email`, `profileImage` URL, `notes`, `status`, full nested address including `gateAccessCode` and `navigationInstructions`. `gender` is `female`, `male`, or `other`. When it is `other`, store an admin-only note and do not put that note on caregiver JSON |
| Assignments | Add or remove caregivers. This is the data behind both `/caregiver/{id}` lists |

Validation proposals: first and last name required; `status` of `active` or `inactive`; date of birth not in the future. `profileImage` is an optional URL. Uploading files is **out of scope** until a product requirement exists. The mobile app never uploads.

Deactivate instead of hard delete when appointments exist. Inactive clients disappear from the caregiver list because that list always sends `status=active`. They can still appear inside old appointments if those embeds include them. **Recommendation:** appointment embeds should still return the client name even when the client is later inactive, so history remains readable.

## Clinical profile (inside the client)

Each block maps to a JSON array the caregiver app already parses.

| Block | Mobile surface | Operations |
|---|---|---|
| Languages | Client detail and appointment embed | Add, edit, delete. One primary. Fields `name`, `proficiency`, `isPrimary`. Proficiency is `native`, `fluent`, `intermediate`, `basic`, or `other` |
| Emergency contacts | Same | `name`, `relationship`, `phone`, `email`, `isPrimary` |
| Diagnoses and allergies | Client detail only | `name`, `icdCode`, `diagnosedDate`, `severity`, `notes`, `isActive`. Allergies are diagnosis rows. Severity is `low`, `moderate`, `high`, or `other` |
| Hazards | Client detail and appointment embed | `type` is `fall_risk` or `other`. `severity` is `low`, `moderate`, `high`, or `other`. Also `description`, `precautions`, `isActive` |
| Service requirements | Appointment embed only | `service`, `startTime`, `endTime` as calendar dates `YYYY-MM-DD` |

For every closed field, `other` requires an admin-only note. The caregiver app humanizes the value to `Other` and has no field for that note. Do not add the note to caregiver responses.

No extra mobile endpoint is required after a save. The next client or appointment GET must include the new rows.

## Care plans

| Screen | Operations |
|---|---|
| List on the client | Name, status, date range, item counts |
| Editor | `name`, `description`, `status`, `notes`, `startDate`, `endDate`, `goals` as an ordered list of strings |
| Tasks | `name`, `frequency`, `description` |
| Medications | `medicationName`, `dosage`, `schedule`, `description` |
| Diet | `meal`, `restrictions`, `description` |
| Hygiene | `activity`, `frequency`, `description` |

Status proposal: `active` and `inactive`. The demo only shows `active`. The app humanizes any string.

Do not let staff edit `completedToday` here. That flag is produced from caregiver toggles.

Deleting an item that has completions should be blocked or should keep history. **Proposal:** deactivate or refuse delete when a completion exists. Not specified by the app.

## Appointments

Needed for the dashboard and visit flow.

| Field | Required | Notes |
|---|---|---|
| Client | Yes | Must be assigned to the selected caregiver, or the save also creates the assignment. **Proposal:** require an existing assignment and show an error otherwise |
| Caregiver | Yes | Role caregiver, active |
| Care plan | No | JSON `carePlanId`. Plans still render from the client embed |
| Description | Yes | |
| `scheduledDate`, `endDate` | Yes | `endDate` on or after `scheduledDate`. Single-day visits use the same date |
| `startTime`, `endTime` | Yes | `HH:mm` |
| `duration` | Yes | Integer minutes |
| `appointmentType` | Yes | `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other`. `other` stores an admin-only note |
| `appointmentStatus` | Yes | `scheduled`, `completed`, `cancelled`. A multi-day visit stays `scheduled` until every day is completed or an admin sets the whole appointment to `completed` |
| `status` | Yes | `active` or `inactive` only. This is not the visit state |
| Instructions, notes | No | Send `""` rather than omitting if the admin form is blank, so the app shows an empty section instead of failing |
| Location | Yes | Flat appointment fields. Button: "Copy from client address" |
| Doctor fields | When type is `doctor_visit` | `doctorName`, `doctorSpecialty`, `doctorPhone`, `clinicName` so the client profile popup works |
| Cancellation reason | Required when status is cancelled | The caregiver PUT also requires `cancellationReason`. The current caregiver body omits it and must be changed before that call succeeds |

List filters **proposal:** date range, caregiver, client, `appointmentStatus`, text search. The mobile app does not need these query params.

Generating daily visit rows from `scheduledDate` through `endDate` is a backend concern. The admin does not have to create them one by one. Staff should see today's status on the appointment detail page.

## Visit monitor

Read-mostly. This is the audit trail of actions the phone already performs.

| View | Contents |
|---|---|
| Daily visits | Appointment, date, `dailyVisitStatus`, active, completed, check-in, check-out |
| Check-ins | Care plan, caregiver, timestamp, lat/long, date |
| Item completions | Plan, item type, item id, item label, date, completed, caregiver |
| Cancellations | Reason, who changed status, when |

**DECIDED:** this visit history is in the first admin release. It is read from check-ins, checklist toggles, daily completions, and cancellations. It is not an export.

Staff correcting a stuck visit is outside v1. Do not add a second status vocabulary. Check-in leaves `dailyVisitStatus` as `pending`, so a pending visit with `checkInTime` set is a normal checked-in visit, not a stuck one.

## Reports, files, and audit logs

| Module | Decision |
|---|---|
| Reports and analytics | **DECIDED out of v1.** No charts and no exported reports. Dashboard counts remain |
| File management | Not required. Image fields are URLs |
| Audit log | **DECIDED for v1.** Record admin actor, action, entity id, and timestamp for create, update, assign, deactivate, and password set. The caregiver app does not read this log |

## Admin API sketch (proposal)

These paths are **not** in the Flutter app. Names can change. Payloads they write must round-trip through the caregiver serializers.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/admin/auth/login` | Admin login |
| GET | `/api/v1/admin/dashboard` | Counts |
| GET/POST | `/api/v1/admin/caregivers` | List, create |
| GET/PATCH | `/api/v1/admin/caregivers/{id}` | Read, update |
| GET/POST | `/api/v1/admin/clients` | List, create |
| GET/PATCH | `/api/v1/admin/clients/{id}` | Read, update |
| PUT | `/api/v1/admin/clients/{id}/caregivers` | Replace assignments |
| CRUD | `/api/v1/admin/clients/{id}/languages` and the other child collections | Clinical profile and care plans |
| GET/POST | `/api/v1/admin/appointments` | List, create |
| GET/PATCH | `/api/v1/admin/appointments/{id}` | Read, update |
| GET | `/api/v1/admin/visits` | Visit history: check-ins, checklist toggles, daily completions, cancellations |
| GET | `/api/v1/admin/audit-log` | Admin change log. Not an export |

Use the same error envelope (`message`, `code`, `errors`) so one client helper works. Pagination for admin lists can be `{ data, meta }` inside `data`, matching the caregiver clients list, or a documented admin shape. It must not be applied to `GET /appointments/caregiver/{id}`.

## Permissions matrix (proposal)

| Action | ADMIN | CAREGIVER |
|---|---|---|
| Admin login and all `/admin` routes | Yes | No |
| `POST /auth/login` with role `CAREGIVER` | No | Yes |
| Read own appointments and clients | No, unless also assigned | Yes |
| Check-in, toggle items, complete, cancel own visit | No | Yes |
| Create clients, plans, appointments | Yes | No |

## UX notes

- Use the same status spellings the phone compares, shown with humanized labels.
- Time inputs save `HH:mm`. Date inputs save `YYYY-MM-DD`.
- Do not show a gate code as required. Empty string is valid.
- Confirm deactivate and cancel.
- After saving a client or appointment, the caregiver app sees the change on its next GET. There is no push channel.
