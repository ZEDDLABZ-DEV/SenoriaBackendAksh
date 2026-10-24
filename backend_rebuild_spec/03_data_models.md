# 03 — Data Models and JSON Contracts

Source of truth: `lib/models/`. Parsers use `as String?`, `as bool?`, `as int?`, or `as num?`. A wrong JSON type throws. The screen then shows a generic error, or login shows a generic failure. Do not send numbers where strings are required, or the strings `"true"` / `"1"` where bools and ints are required.

**Missing vs null:** unless a row below says "stays null", a missing or JSON-null string becomes `""`, a missing bool becomes the listed default, and a missing list becomes `[]`.

**Dates:** `DateTime.tryParse`. Invalid or empty strings become null and the field is blank in the UI. Compatible examples:

| Kind | Example | Where |
|---|---|---|
| Calendar date | `2026-10-19` | `scheduledDate`, `endDate`, `dateOfBirth`, `diagnosedDate`, care-plan dates, request `date` |
| Clock time | `09:00` or `14:30` | `startTime`, `endTime` on appointments. 24-hour `HH:mm`. The UI prints `9:00 AM` |
| Timestamp | `2026-10-19T17:32:00` or `2026-10-19T12:02:00.000Z` | `checkInTime`, `checkOutTime`, check-in request `timestamp` |

`duration` is minutes. `expiresIn` is seconds. **DECIDED:** login and refresh send `expiresIn: 86400`. The app does not enforce it. Money fields do not exist.

Identifiers are string `id`. **DECIDED:** they are UUID strings. The client never reads `_id`, `userId` (except the stored user object's `id`), or integer ids.

Legacy files in `lib/shared/models/` (`Client`, `Appointment`, `CarePlan`, and related) have no JSON parsers and are not imported. They are not this contract.

---

## Envelope types

### Success wrapper

Not a Dart class. `ApiClient` returns `data` and drops the wrapper.

| JSON field | Type | Required | Client reads it? |
|---|---|---|---|
| `message` | string | No | Only on errors |
| `code` | string | No | Only on errors |
| `data` | any | Yes for a useful success | Yes |
| `success` | bool | No | No |

### `PaginationMetaModel`

File: `lib/models/pagination_meta_model.dart`. Used only as `meta` inside the clients list payload.

| JSON field | Type | Missing default |
|---|---|---|
| `total` | int | `0` |
| `page` | int | `1` |
| `pageSize` | int | `10` |
| `totalPages` | int | `0` |
| `hasNextPage` | bool | `false` |
| `hasPreviousPage` | bool | `false` |

---

## Auth models

### `UserModel`

File: `lib/models/user_model.dart`. Nested at `data.user` on login. Stored with `toJson()` under GetStorage key `user`.

| JSON field | Dart type | Missing default | Notes |
|---|---|---|---|
| `id` | `String` | `""` | Later sent as the caregiver path id |
| `email` | `String` | `""` | Shown from cache |
| `firstName` | `String` | `""` | Greeting name |
| `lastName` | `String` | `""` | |
| `role` | `String` | `""` | Must be `CAREGIVER` ignoring case |
| `avatar` | `String?` | null | Not rendered in the screens reviewed |
| `permissions` | `List<String>` | `[]` | Parsed, never checked. **DECIDED:** always `[]`. The admin app uses role `ADMIN` and has no named permission strings in v1 |

`toJson` writes `avatar: null` when avatar is null. The server may omit it or send null.

### `LoginResponseModel`

File: `lib/models/login_response_model.dart`. This is the login `data` object, not the HTTP body.

| JSON field | Type | Missing default |
|---|---|---|
| `user` | object | empty user |
| `accessToken` | string | `""` |
| `refreshToken` | string | `""` |
| `expiresIn` | int | `0` |

`expiresIn` is not written to storage. **DECIDED:** the access token is a JWT lasting 24 hours, so this field is `86400`. The refresh token in the same payload is opaque, lasts 30 days, and rotates on every successful refresh.

### `RefreshTokenResponseModel`

File: `lib/models/refresh_token_response_model.dart`. Refresh `data` object.

| JSON field | Type | Missing default |
|---|---|---|
| `accessToken` | string | `""` (treated as failure) |
| `refreshToken` | string | `""` (old token kept) |
| `expiresIn` | int | `0`. **DECIDED:** `86400`. A new non-empty `refreshToken` is required because rotation invalidates the previous opaque token |

---

## `AppointmentModel`

File: `lib/models/appointment_model.dart` lines 6–114.

Returned by appointment list elements and `GET /appointments/{id}`. Also accepted as the PUT cancel `data` when the object contains `id`.

| JSON field | Dart type | Missing default | Notes |
|---|---|---|---|
| `id` | `String` | `""` | |
| `description` | `String` | `""` | |
| `scheduledDate` | date string or null | null | Multi-day range starts here |
| `endDate` | date string or null | null | |
| `startTime` | `String` | `""` | `HH:mm` |
| `endTime` | `String` | `""` | `HH:mm` |
| `duration` | int from `num` | `0` | Minutes. `90` renders `1 hr 30 min` |
| `appointmentType` | `String` | `""` | Snake case is humanized in the UI. **DECIDED values:** `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other` |
| `appointmentStatus` | `String` | `""` | Whole-appointment status. See enums |
| `instructions` | `String` | `""` | |
| `notes` | `String` | `""` | |
| `checkInTime` | `String?` | null | Non-empty means checked in |
| `checkOutTime` | `String?` | null | |
| `cancellationReason` | `String?` | null | Shown only when `appointmentStatus` is `cancelled` or `canceled` and the trimmed text is non-empty (`appointment_detail_view.dart` 397–398) |
| `status` | `String` | `""` | Separate from `appointmentStatus`. **DECIDED:** `active` or `inactive` only. It is not the visit state |
| `locationStreet` | `String` | `""` | Flat. Not an `address` object |
| `locationCity` | `String` | `""` | |
| `locationState` | `String` | `""` | |
| `locationZipCode` | `String` | `""` | |
| `locationGateCode` | `String?` | null | Hidden until the scheduled calendar day |
| `locationNavigation` | `String` | `""` | Directions text |
| `clientId` | `String` | `""` | |
| `caregiverId` | `String` | `""` | |
| `carePlanId` | `String?` | null | Optional link. UI iterates `client.carePlans`, not only this id |
| `completedToday` | `bool` | `false` | Server-computed. **DECIDED:** true only for the current day in `X-Timezone`, or in `America/Vancouver` when that header is missing or invalid. A visit finished on an earlier day returns `false` |
| `activeToday` | `bool` | `false` | Same timezone rule |
| `dailyVisitStatus` | `String` | `""` | Empty displays as Pending |
| `client` | object or absent | null | `AppointmentClientModel` |
| `caregiver` | object or absent | null | `AppointmentCaregiverModel`. Comment says detail-only; list demo still includes it |

### Status strings the UI branches on (CONFIRMED)

Comparisons are case-insensitive.

**`appointmentStatus`**

| Value | UI |
|---|---|
| `scheduled` | Scheduled tab, `isScheduled` |
| `completed` | Completed tab |
| `cancelled` or `canceled` | Cancelled tab, hides the action bar |

**`dailyVisitStatus`**

| Value | UI |
|---|---|
| `pending` | Warning chip. Required by `canCheckIn` together with `activeToday` and not `completedToday` |
| `in_progress` or `ongoing` | Warning chip. Counts as visit in progress, which shows the complete/cancel bar after check-in |
| `completed` | Success chip |
| `cancelled`, `canceled`, or `missed` | Danger chip. Daily visit is not open |
| anything else | Primary chip, humanized (`respite_care` → `Respite Care`) |

**DECIDED check-in result:** `dailyVisitStatus` stays `pending`. The complete/cancel bar still appears because `checkInTime` is non-empty and `isDailyVisitOpen` is true for `pending`. The `in_progress` / `ongoing` row is what the UI does if those values are sent. This check-in must not send them.

**`appointmentType` (DECIDED closed list):** `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other`.

`doctor_visit` is special only on `ClientAppointmentModel` (the client profile), where it opens doctor fields. `other` is humanized to `Other`. The admin note stored for `other` is not a field on this model and must not be added to caregiver JSON.

### Derived rules (client-side, CONFIRMED)

| Getter | Rule |
|---|---|
| `isFutureDate` | `scheduledDate` calendar day is after the device's local today. Null date is not future |
| `hasReachedScheduledDate` | not `isFutureDate` |
| `isUpcoming` | scheduled day is today or later, compared in UTC calendar components |
| `isCheckedIn` | `checkInTime` trim is non-empty |
| `canCheckIn` | not `completedToday`, `activeToday`, `dailyVisitStatus` is `pending` |
| `isDailyVisitOpen` | `activeToday` and not `completedToday` and daily status is not cancelled/canceled/missed |
| `isActionable` | appointment status is not completed and not cancelled. The getter is unused. The action bar uses `isCancelled`, `isDailyVisitOpen`, and check-in state |
| `allCarePlanItemsCompleted` | every task, medication, diet, and hygiene on embedded care plans has `completedToday`. True when there are no items |

Gate code and care-plan editing unlock when `hasReachedScheduledDate` is true.

---

## `AppointmentClientModel`

File: `appointment_model.dart` lines 328–430. Embedded as `client` on an appointment.

| JSON field | Dart type | Missing default |
|---|---|---|
| `id` | `String` | `""` |
| `firstName` | `String` | `""` |
| `lastName` | `String` | `""` |
| `dateOfBirth` | date or null | null |
| `gender` | `String` | `""`. **DECIDED:** `female`, `male`, or `other`. The label is humanized, so `other` displays as `Other`. No admin-note field |
| `phone` | `String` | `""` |
| `email` | `String?` | null |
| `profileImage` | `String?` | null |
| `notes` | `String` | `""` |
| `status` | `String` | `""` |
| `languages` | array | `[]` |
| `hazards` | array | `[]` |
| `emergencyContacts` | array | `[]` |
| `serviceRequirements` | array | `[]` |
| `carePlans` | array | `[]` |

No diagnoses field. No address field. Appointment location is on the parent.

List-endpoint comment (lines 326–327): list payloads may only include `firstName` and `lastName`. Other fields then render empty. Detail should send the full object.

---

## `ClientLanguageModel`

File: `appointment_model.dart` 434–453. No `id`.

| JSON field | Type | Missing default |
|---|---|---|
| `name` | string | `""` |
| `proficiency` | string | `""` |
| `isPrimary` | bool | `false` |

**DECIDED `proficiency`:** `native`, `fluent`, `intermediate`, `basic`, `other`. `proficiencyLabel` humanizes `other` to `Other`. The admin note is not parsed and must not be sent.

## `ClientHazardModel`

File: `appointment_model.dart` 457–483. No `id`.

| JSON field | Type | Missing default |
|---|---|---|
| `type` | string | `""` |
| `description` | string | `""` |
| `severity` | string | `""` |
| `precautions` | string | `""` |
| `isActive` | bool | `true` |

**DECIDED `type`:** `fall_risk`, `other`. **DECIDED `severity`:** `low`, `moderate`, `high`, `other`. Labels are humanized, so `other` displays as `Other`. The admin note is not a JSON field. The hazard color switch treats `high` and `critical` as danger and `medium` as warning. `moderate`, `low`, and `other` use the default color. Send the decided spellings anyway. Do not send `medium` in place of `moderate`.

## `EmergencyContactModel`

File: `appointment_model.dart` 487–510. No `id`.

| JSON field | Type | Missing default |
|---|---|---|
| `name` | string | `""` |
| `relationship` | string | `""` |
| `phone` | string | `""` |
| `email` | string or null | null |
| `isPrimary` | bool | `false` |

## `AppointmentCaregiverModel`

File: `appointment_model.dart` 514–536. No `id`.

| JSON field | Type | Missing default |
|---|---|---|
| `firstName` | string | `""` |
| `lastName` | string | `""` |
| `phone` | string | `""` |
| `email` | string or null | null |

---

## `ClientModel`

File: `lib/models/client_model.dart` lines 11–198.

Used by the clients list and `GET /clients/{id}`.

| JSON field | Dart type | Missing default | Notes |
|---|---|---|---|
| `id` | `String` | `""` | |
| `firstName` | `String` | `""` | |
| `lastName` | `String` | `""` | |
| `dateOfBirth` | date or null | null | |
| `gender` | `String` | `""` | **DECIDED:** `female`, `male`, `other`. Displayed through `genderLabel` |
| `phone` | `String` | `""` | |
| `email` | `String?` | null | |
| `profileImage` | `String?` | null | URL string. The app does not upload |
| `notes` | `String` | `""` | |
| `status` | `String` | `""` | List query filters `active` |
| `address` | object | optional | Preferred shape below |
| `addressStreet` or `address.street` | string | `""` | Nested wins when non-empty |
| `addressApartment` or `address.apartment` | string | `""` | |
| `addressCity` or `address.city` | string | `""` | |
| `addressState` or `address.state` | string | `""` | |
| `addressZipCode` or `address.zipCode` | string | `""` | |
| `addressCountry` or `address.country` | string | `""` | |
| `gateAccessCode` or `address.gateAccessCode` | string | `""` | |
| `navigationInstructions` or `address.navigationInstructions` | string | `""` | |
| `languages` | array | `[]` | |
| `emergencyContacts` | array | `[]` | |
| `diagnoses` | array | `[]` | UI section title is "Diagnoses & Allergies" |
| `hazards` | array | `[]` | |
| `carePlans` | array | `[]` | |
| `appointments` | array | `[]` | `ClientAppointmentModel` |

`serviceRequirements` is not parsed on `ClientModel`. It is parsed only on the appointment embed. Client detail does not show service requirements.

### Nested `address` (preferred, CONFIRMED by demo and parser)

```json
"address": {
  "street": "1284 Maple Street",
  "apartment": "Apt 2",
  "city": "Surrey",
  "state": "BC",
  "zipCode": "V3T 2W1",
  "country": "Canada",
  "gateAccessCode": "4821",
  "navigationInstructions": "Use the side entrance."
}
```

Flat keys on the client object are a fallback. Prefer the nested object.

---

## `DiagnosisModel`

File: `client_model.dart` 202–233. Client detail only.

| JSON field | Type | Missing default |
|---|---|---|
| `id` | string | `""` |
| `name` | string | `""` |
| `icdCode` | string or null | null |
| `diagnosedDate` | date or null | null |
| `severity` | string or null | null. **DECIDED when set:** `low`, `moderate`, `high`, `other`. Displayed through `severityLabel`. Admin note is omitted |
| `notes` | string | `""` |
| `isActive` | bool | `true` |

There is no separate allergy model. Demo stores a penicillin allergy as a diagnosis (`name`, `icdCode: "Z88.0"`).

## `ServiceRequirementModel`

File: `client_model.dart` 238–260. Appointment client embed only.

| JSON field | Type | Missing default |
|---|---|---|
| `id` | string | `""` |
| `service` | string | `""` |
| `startTime` | date or null | null |
| `endTime` | date or null | null |

Demo puts calendar dates in `startTime` and `endTime`, not clock times. The appointment UI prints them with `DateFormatter.prettyDate`.

## `CarePlanModel`

File: `client_model.dart` 266–349.

| JSON field | Type | Missing default | Alternate key |
|---|---|---|---|
| `id` | string | `""` | |
| `name` | string | `""` | `title` if `name` is null |
| `description` | string | `""` | |
| `status` | string | `""` | Demo: `active` |
| `notes` | string | `""` | |
| `startDate` | date or null | null | |
| `endDate` | date or null | null | |
| `goals` | string, array of strings, or array of objects | `[]` | Object text from `description`, else `title`, else `name`, else `task` |
| `tasks` | array | `[]` | |
| `medications` | array | `[]` | |
| `dietInstructions` | array | `[]` | |
| `hygieneInstructions` | array | `[]` | |

### `CareTaskModel`

| JSON field | Type | Missing default |
|---|---|---|
| `id` | string | `""` |
| `name` | string | `""` |
| `frequency` | string | `""` |
| `description` | string | `""` |
| `completedToday` | bool | `false` |

### `CareMedicationModel`

| JSON field | Type | Missing default | Alternate key |
|---|---|---|---|
| `id` | string | `""` | |
| `medicationName` | string | `""` | `name` |
| `dosage` | string | `""` | |
| `schedule` | string | `""` | `frequency` |
| `description` | string | `""` | |
| `completedToday` | bool | `false` | |

### `CareDietModel`

| JSON field | Type | Missing default |
|---|---|---|
| `id` | string | `""` |
| `meal` | string | `""` |
| `restrictions` | string | `""` |
| `description` | string | `""` |
| `completedToday` | bool | `false` |

### `CareHygieneModel`

| JSON field | Type | Missing default |
|---|---|---|
| `id` | string | `""` |
| `activity` | string | `""` |
| `frequency` | string | `""` |
| `description` | string | `""` |
| `completedToday` | bool | `false` |

`completedToday` is date-specific from the server's point of view. The checklist sends `date` when toggling. The read models have no date field; they only expose the bool. **DECIDED:** the bool is for the current day in `X-Timezone`, falling back to `America/Vancouver` because this app does not send that header. The toggle request still carries `DateFormatter.isoDate(DateTime.now())`, which is the device's local calendar date. A device outside `America/Vancouver` can therefore post a `date` that is not the day used for `completedToday`. A second toggle flips the item. Daily completion does not flip back.

---

## `ClientAppointmentModel`

File: `client_model.dart` 465–534. Nested at `client.appointments[]` on the client profile. This is a summary, not `AppointmentModel`.

| JSON field | Type | Missing default |
|---|---|---|
| `id` | string | `""` |
| `description` | string | `""` |
| `scheduledDate` | date or null | null |
| `startTime` | string | `""` |
| `endTime` | string | `""` |
| `appointmentType` | string | `""` |
| `appointmentStatus` | string | `""` |
| `caregiver` | object | optional |
| `caregiver.firstName` | string | `""` |
| `caregiver.lastName` | string | `""` |
| `doctorName` | string or null | null |
| `doctorSpecialty` | string or null | null |
| `doctorPhone` | string or null | null |
| `clinicName` | string or null | null |

`appointmentType` of `doctor_visit` (case-insensitive) opens the doctor popup. Other types show the caregiver visit row. Doctor fields are omitted on ordinary visits.

---

## Care-plan toggle response

Not a named model. `appointment_care_plan_view.dart` 92–95.

| JSON field | Type | If absent |
|---|---|---|
| `completed` | bool | Optimistic value kept |

This object is the envelope `data`, not the HTTP body root.

## Check-in request body

Not a named model. Commented code in `appointment_detail_controller.dart` 129–136. This is what the current app sends:

| JSON field | Type | Sent today? |
|---|---|---|
| `timestamp` | string, UTC ISO-8601 | Yes |
| `location.latitude` | number | Yes |
| `location.longitude` | number | Yes |
| `date` | string `YYYY-MM-DD` | Yes |
| `appointmentId` | string | **No.** The controller has `_appointmentId` and does not put it in this map |

**DECIDED response `data`:** the full appointment. `checkInTime` is set. `dailyVisitStatus` stays `pending`. The app ignores this body and refetches. A future client may add `appointmentId`. Until then, the server uses the unique-visit rule in `02_api_inventory.md`. There is no timezone header on this request.

## Daily completion request body

| JSON field | Type |
|---|---|
| `date` | string `YYYY-MM-DD` |

**DECIDED response `data`:** `{ "appointmentId", "date", "completed": true }`. A repeat call for that appointment and date returns `completed: true` again. It does not undo the day.

## Cancel request body

| JSON field | Type | Sent by the current commented call? |
|---|---|---|
| `appointmentStatus` | string `cancelled` | Yes |
| `cancellationReason` | non-empty string | **No.** The dialog collected it and the JSON omits it |

**DECIDED:** both fields are required. The current body is rejected with 422. **DECIDED response `data`:** the full appointment, including `id`, `appointmentStatus: "cancelled"`, and `cancellationReason`.

---

## Enum and spelling registry

Send these exact spellings when producing the demo-equivalent states. The client lowercases before comparing and humanizes underscores for display.

| Domain | Send |
|---|---|
| User role | `CAREGIVER` on this app. Admin app uses `ADMIN` |
| Client status requested by the app | `active` |
| Client and care plan `status` | `active`, `inactive` |
| Appointment record `status` | `active`, `inactive` |
| `appointmentStatus` | `scheduled`, `completed`, `cancelled` |
| `dailyVisitStatus` | `pending`, `in_progress`, `completed`, `cancelled` |
| Also accepted when reading daily status | `ongoing`, `canceled`, `missed` |
| After caregiver check-in | `dailyVisitStatus` stays `pending` |
| Checklist `itemType` | `task`, `medication`, `diet`, `hygiene` |
| Gender | `female`, `male`, `other` |
| Appointment type | `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other` |
| Hazard type | `fall_risk`, `other` |
| Severity (hazard and diagnosis) | `low`, `moderate`, `high`, `other` |
| Proficiency | `native`, `fluent`, `intermediate`, `basic`, `other` |
| Hazard `isActive` default when omitted | `true` |
| Diagnosis `isActive` default when omitted | `true` |

When a closed value is `other`, the admin app stores a free-text note. Caregiver JSON does not include that note. `AppointmentModel.humanize` turns `other` into `Other`.
