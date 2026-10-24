# 02 — Admin Request and Response Models

JSON names below are the names the admin app reads or writes. Do not rename them. Types are Dart types after parsing. “Required on parse” means the code casts with `as String` / `as Map` and throws if the value is null or the wrong type. “Optional” means a nullable read with a default.

Conventions **CONFIRMED** across serializers:

- Property names are camelCase.
- Request dates that the app formats itself are `yyyy-MM-dd` (`DateFormat` or manual padding). They are local calendar dates, not UTC instants.
- Appointment clock times in requests are `HH:mm` (24-hour, zero-padded).
- Response dates and timestamps use `DateTime.tryParse`. ISO 8601 is what that parser accepts. Appointment `scheduledDate` is then reduced to the UTC calendar day (`year/month/day` of the UTC value) so display does not shift across timezones.
- Booleans are JSON booleans. Integers accept JSON numbers; several parsers also accept numeric strings.
- Empty strings are sent for many optional text fields. The app often does not omit the key.

UI-only models (`Diagnosis`, `LanguageInfo`, `Directions`, `HazardInfo`, `ServiceRequirementInfo`, `CarePlan` as edited in memory) are included where they affect a payload or a round-trip.

---

## Envelope fields used by more than one call

| Field | Type | Where required |
|---|---|---|
| `success` | bool, default false | Login, refresh, client create/get/put, client list, care-plan creates. Ignored for control flow on most calls; login does not branch on it. |
| `message` | string, default `""` | Same family. Login shows it in the success snackbar when non-empty. |
| `data` | object or array | Required object for login (`data` cast) and refresh (`data` cast). Optional object for client and care-plan responses. |
| `timestamp` | string or null | Login and client create/get/put. Stored, not displayed. |
| `requestId` | string or null | Login and client create/get/put. Stored, not displayed. |

Error object, any failing status (**CONFIRMED** in `ApiClient._extractMessage` / `_extractCode` / `_extractFields`):

```json
{
  "error": {
    "message": "string",
    "code": "string",
    "fields": { "fieldName": "any JSON" }
  }
}
```

Top-level `message`, `code`, `fields`, and `errors` are fallbacks. The app does not assume `errors` values are arrays. It keeps the map as `Map<String, dynamic>` and displays only the top-level message, not per-field errors, except that `422` still shows that one message.

**Decided.** Keep this parser. Also keep the caregiver parser, which reads only top-level `message`, `code`, and `errors` as a map of string arrays. The server sends both shapes on every error, with the same text in `message` and `error.message`.

---

## Auth

### `LoginRequest` — POST `/auth/login` body

| JSON | Dart | Required in body |
|---|---|---|
| `email` | String | Yes. Trimmed. |
| `password` | String | Yes. Not trimmed. |

**Decided.** Do not require `role`. If it is sent, ignore it. Exactly one account has role `ADMIN`. Every other account is `CAREGIVER`. The response `user.role` is the stored role.

### `LoginResponse` / `LoginData` / `User`

`LoginResponse.fromJson` requires `data` to be a Map.

`LoginData`:

| JSON | Dart | Parse rule | UI use |
|---|---|---|---|
| `user` | object | Required Map | Stored |
| `accessToken` | String | Required `as String` | Stored, sent as Bearer |
| `refreshToken` | String | Required `as String` | Stored |
| `expiresIn` | int | `as int?` default `0` | Seconds from now. **Decided:** login sends `3600`. `0` signs the admin out. It does not start a session. |

`User`:

| JSON | Dart | Parse rule | UI use |
|---|---|---|---|
| `id` | String | Required `as String` | Stored. Not shown on dashboard. |
| `email` | String | Required `as String` | Session email |
| `firstName` | String | default `""` | Greeting via `fullName` |
| `lastName` | String | default `""` | Greeting via `fullName` |
| `role` | String | default `""` | Must upper-case to `ADMIN` or login is rejected **before** tokens are saved |
| `avatar` | String or null | optional | **Decided:** unused for now. Omit or send `null`. Not rendered. |
| `permissions` | string array | non-list becomes `[]`. Elements `toString()` | Stored. `hasPermission` exists and is never called. **Decided:** the server sends `[]` and does not enforce permission strings. |

### `RefreshTokenResponse` / `RefreshData`

Requires `data` Map and `accessToken` `as String`.

| JSON | Dart | Parse rule |
|---|---|---|
| `accessToken` | String | Required |
| `refreshToken` | String or null | Optional. Empty/null does not overwrite the stored refresh token. |
| `expiresIn` | int | **Decided:** refresh sends `3600`. `0` signs the admin out. |

`success` and `message` are parsed and not used to accept or reject the refresh. HTTP status does that.

---

## Dashboard

### `DashboardStats` — object under `data`, or the root if `data` is not a Map

All fields are integers. Missing, null, or non-numeric values become `0`.

| JSON | Displayed on dashboard |
|---|---|
| `totalClients` | Yes |
| `todayAppointments` | Yes |
| `activeCarePlans` | Parsed only |
| `totalCaregivers` | Parsed only |
| `completedAppointmentsToday` | Parsed only |
| `pendingAppointmentsToday` | Parsed only |
| `clientsGrowth` | Parsed only |
| `appointmentsGrowth` | Parsed only |

**Decided:** `clientsGrowth` and `appointmentsGrowth` are unused for now. The server may omit them or send `0`. The app does not display them.

---

## Clients

### `CreateClientRequest` — POST `/clients` and the basis of PUT shape A

| JSON | Type | Notes |
|---|---|---|
| `firstName` | string | First whitespace-separated token of the full-name field. |
| `lastName` | string | Remainder, or `""` if the name is a single token. |
| `dateOfBirth` | string | `yyyy-MM-dd`. |
| `phone` | string | Required by the form. |
| `gender` | string | Enum `.name`: `male`, `female`, `other`. Form default `female`. |
| `emergencyContactName` | string | Required by the form. |
| `emergencyContactRelation` | string | Required by the form. |
| `emergencyContactPhone` | string | Required by the form. |
| `primaryCondition` | string | May be empty. Not form-required. |
| `medicalConditions` | string[] | May be empty. |
| `allergies` | string[] | May be empty. Values are plain text, not prefixed with `Allergy:`. |
| `language` | string | Single preferred language. Additional languages are not sent. |
| `communicationNote` | string | May be empty. |
| `address` | object | Always present. |
| `address.street` | string | |
| `address.city` | string | |
| `address.state` | string | |
| `address.zipCode` | string | Form label is postal / zip. |
| `address.country` | string | |
| `address.apartment` | string | Always `""` on create. |
| `address.gateAccessCode` | string | |
| `address.navigationInstructions` | string | |

Not sent on create: `email`, `status`, `profileImage`, nested diagnosis objects, hazard objects, service requirements, care plan.

### PUT `/clients/{id}` shape B (directions only)

Adds `email` (string, cached or `""`) and `status` (cached string or `"active"`). Omits emergency-contact keys, `primaryCondition`, `medicalConditions`, `allergies`, `language`, and `communicationNote`. Address keys match create.

### `CreateClientResponse` / `ClientData`

Used for POST, GET by id, and PUT. `data` may be null.

`ClientData` fields. All strings except `id`, `firstName`, and `lastName` are optional (`as String?`). `id` defaults to `""` rather than throwing.

| JSON | Type | Consumed |
|---|---|---|
| `id` | string | Yes |
| `firstName` | string | Yes |
| `lastName` | string | Yes |
| `dateOfBirth` | string or null | Parsed for age. Reformatted to `yyyy-MM-dd` on PUT. Not shown as a date; age is shown. |
| `gender` | string or null | `male` / `other` map to those enums. Anything else, including null, becomes `female`. |
| `phone` | string or null | Yes |
| `email` | string or null | Shown on client detail. Not editable from a reachable screen. |
| `profileImage` | string or null | **Decided:** unused for now. Omit or send `null`. The hero shows initials. |
| `notes` | string or null | Treated as communication notes. |
| `status` | string or null | Not shown. Re-sent on directions PUT. **Decided:** `active` or `inactive` only. Create omits it, and the server defaults a new client to `active`. |
| `createdAt` | string or null | Parsed, not shown. |
| `updatedAt` | string or null | Parsed, not shown. |
| `createdById` | string or null | Parsed, not shown. |
| `updatedById` | string or null | Parsed, not shown. |
| `deletedAt` | string or null | Parsed, not shown. **Decided:** unused. Deleting a client removes the row. The server may omit this field or send `null`. |
| `address` | object or null | See `AddressData`. |
| `emergencyContacts` | array | Non-maps skipped. |
| `diagnoses` | array | |
| `languages` | array | |
| `hazards` | array | |
| `serviceRequirements` | array | |
| `carePlans` | array | **Decided:** at most one plan. The UI uses the first item. |
| `appointments` | array | Shown on client detail. |

### `EmergencyContactData`

| JSON | Type | Notes |
|---|---|---|
| `id` | string, default `""` | |
| `name` | string, default `""` | |
| `relationship` | string or null | Displayed in parentheses after the name when non-empty. |
| `phone` | string or null | |
| `email` | string or null | Parsed, not shown on the client card. |
| `isPrimary` | bool, default false | The contact with `isPrimary == true` is preferred; otherwise the first contact. |
| `clientId` | string or null | Parsed, not shown. |
| `createdAt`, `updatedAt` | string or null | Parsed, not shown. |

### `DiagnosisData`

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `icdCode` | string or null | Shown in the note line only when `notes` is empty. **Decided:** the web portal can edit it. The phone never sends it, and a phone diagnosis save must not clear it. |
| `diagnosedDate` | string or null | Parsed, not shown. |
| `severity` | string or null | Shown in the note line only when `notes` is empty. |
| `notes` | string or null | **Round-trip key.** The app classifies rows by exact `notes` text. |
| `isActive` | bool, default true | Parsed. Not used to hide rows. |
| `clientId`, `createdAt`, `updatedAt` | string or null | Parsed, not shown. |

Classification **CONFIRMED** in `ClientData.toClient` and `_buildClientPayload`:

| `notes` value | Treated as |
|---|---|
| `Primary condition` | `primaryCondition` (name). If none match, the first diagnosis is used. |
| `Medical condition` | an entry in `medicalConditions` |
| `Allergy` | an allergy. A leading `Allergy: ` on `name` is stripped when building the allergy list. |

Any other `notes` value still appears in the diagnosis tile list, but it is not copied into `primaryCondition`, `medicalConditions`, or `allergies`. A later diagnosis/language PUT can therefore drop it from the payload. **INFERRED** risk, **CONFIRMED** filter.

### `LanguageData`

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | Shown. Primary language is `isPrimary == true`, else the first. |
| `proficiency` | string or null | Parsed, not shown. Allowed values **UNKNOWN**. |
| `isPrimary` | bool, default false | |
| `clientId`, `createdAt`, `updatedAt` | string or null | Parsed, not shown. |

The language sheet writes one `language` string and `communicationNote` (client `notes`). It does not send `proficiency`, `isPrimary`, or additional languages.

### `AddressData`

| JSON | Type | Notes |
|---|---|---|
| `id` | string or null | Parsed. Not sent back on PUT (the PUT address object has no `id`). |
| `street` | string or null | Mapped to directions address. Apartment, if present, is appended in the UI as `Apt <value>` but the PUT sends street and apartment as separate fields. |
| `apartment` | string or null | Preserved on PUT from the cache. No editor. |
| `city`, `state`, `country` | string or null | |
| `zipCode` | string or null | Also accepts `postalCode` on **read**. Writes `zipCode` only. |
| `gateAccessCode` | string or null | |
| `navigationInstructions` | string or null | |
| `latitude`, `longitude` | number or numeric string or null | **Decided:** unused for now. Omit or send `null`. Not shown. Not written. |

`Directions.entryInstructions` and `Directions.parkingInfo` are local-only. The API address object has no those keys. Client detail will show them only if something in memory set them. `GET` mapping does not fill them.

### `HazardData` (nested on the client)

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `type` | string or null | **Decided:** only `environmental_risks` or `medical_risks`. |
| `description` | string or null | The hazard text. |
| `isActive` | bool, default true | Parsed. Not written and not shown. |
| `clientId` | string or null | |

### `ServiceRequirementData` (nested on the client)

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `category` | string or null | `medical` (case-insensitive) → Medical. Anything else → Non-medical. Also used as the client “care type” label from the **first** requirement (`General Care` if the category is empty). |
| `name` | string | |
| `description` | string or null | |
| `frequency` | string or null | Read mapping: `daily`, `weekly`, `biweekly` or `bi-weekly`, `monthly`, `asneeded` / `as needed` / `as-needed`. Anything else becomes weekly. |
| `specialInstructions` | string or null | Taken from the first requirement only. |
| `isActive` | bool, default true | Copied onto the local requirement. |
| `clientId` | string or null | |

The service-requirement sheet edits this locally and does not POST or PUT it. Priority is a local enum (`low`, `medium`, `high`) with **no JSON field** on this object.

### `CarePlanData` (nested on the client, and POST `/care-plans` response)

| JSON | Type | Notes |
|---|---|---|
| `id` | string | Required for nested item URLs. |
| `name` | string | |
| `description` | string or null | |
| `startDate`, `endDate` | string or null | `DateTime.tryParse`. |
| `goals` | string array | Non-strings dropped. |
| `notes` | string or null | Parsed. The create body does not send `notes`. The local editor does not edit this field separately from description. |
| `status` | string or null | Empty becomes `active`. Known write values: `active`, `inactive`, `completed`. |
| `tasks` | array of objects | Mapped to category task. Item keys read: `id`, `name`, `description`, `frequency`. |
| `medications` | array of objects | Keys read: `id`, `medicationName`, `description`, `dosage`, `schedule`. |
| `dietInstructions` | array of objects | Keys read: `id`, `meal`, `description`, `restrictions`. |
| `hygieneInstructions` | array of objects | Keys read: `id`, `activity`, `description`, `frequency`. |

`CarePlanData.toJson` does **not** write the four item arrays. That method is not used as a request body.

### `AppointmentData` (nested on `GET /clients/{id}`, not the appointments list)

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string or null | Fallback display `Appointment`. |
| `description` | string or null | Parsed, not the primary list line. |
| `scheduledDate` | string or null | Combined with `startTime`. |
| `startTime`, `endTime` | string or null | `HH:mm` expected. End time is not shown on the client appointment row. |
| `duration` | number or null | Minutes. |
| `appointmentType` | string or null | Shown as type. |
| `appointmentStatus` | string or null | `completed` → completed; `cancelled` or `canceled` → cancelled; **everything else → scheduled**. This nested parser does **not** map `no_show` to cancelled (the appointments module does). |
| `instructions` | string or null | |
| `caregiverId` | string or null | Parsed, not shown (the name is). |
| `caregiver` | object or null | `firstName`, `lastName` only. |

### `ClientsListResponse`

See inventory. Items are full `ClientData` objects, not a slimmer list DTO. **UNKNOWN** whether the list payload omits nested arrays in production; the parser will simply yield empty arrays.

---

## Care plan writes

### `CreateCarePlanRequest`

| JSON | Included when |
|---|---|
| `clientId` | always |
| `name` | always, trimmed |
| `description` | always, trimmed, may be `""` |
| `startDate` | only if the user picked a date |
| `endDate` | only if the user picked a date |
| `goals` | always, array, empty strings removed |
| `status` | always. One of `active`, `inactive`, `completed`. Default `active`. |

### Item requests

| Endpoint | Body keys | Empty string allowed |
|---|---|---|
| diet | `meal`, `restrictions`, `description` | restrictions, description. `meal` is the title the sheet requires. |
| medications | `medicationName`, `dosage`, `schedule`, `description` | dosage, schedule, description |
| hygiene | `activity`, `frequency`, `description` | frequency, description |
| tasks | `name`, `frequency`, `description` | frequency, description |

Response objects add optional `id` and `carePlanId`. Diet/medication/hygiene/task parsers also accept the entity at `data`, or at `diet` / `medication` / `hygiene` / `task`, or as the root when the identifying key (`meal`, `medicationName`, `activity`, `name`) is present.

Medication `schedule` UI options (**CONFIRMED** constants, not a server enum fetch): `OD`, `BD`, `TDS`, `QID`, `PRN`, `HS`.

---

## Hazards write model (`Hazard.toCreateJson`)

| JSON | Value |
|---|---|
| `type` | `environmental_risks` or `medical_risks` |
| `description` | user text |

Create is `POST /clients/{clientId}/hazards`. Edit is `PUT /clients/{clientId}/hazards/{hazardId}` with the same two keys. There is no `severity` and no `precautions`.

---

## Appointments

### `AppointmentListItem` — one row of GET `/appointments`

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `scheduledDate` | string or null | ISO; displayed as the UTC calendar day. |
| `startTime` | string | `HH:mm` expected. |
| `endTime` | string | |
| `clientName` | string | Denormalized. Not an id. |
| `caregiverName` | string | Denormalized. |
| `status` | string | Passed through `AppointmentStatusX.fromApi`. |
| `type` | string | Raw code such as `regular_visit`. Humanized for display by splitting on `_`. |

### `AppointmentStatusX.fromApi` (**CONFIRMED**)

| Raw value | App status | `apiValue` written back |
|---|---|---|
| `completed` | completed | `completed` |
| `cancelled`, `canceled`, `no_show` | cancelled | `cancelled` |
| `scheduled`, `confirmed`, `in_progress`, `rescheduled`, empty, anything else | scheduled | `scheduled` |

Editing a `confirmed`, `in_progress`, or `rescheduled` visit and saving will send `scheduled` unless the user picks Completed or Cancelled. **CONFIRMED** data-loss risk.

### POST `/appointments` body

| JSON | Type |
|---|---|
| `description` | string (instructions field; may be empty) |
| `clientId` | string |
| `caregiverId` | string |
| `scheduledDate` | `yyyy-MM-dd` |
| `startTime` | `HH:mm` |
| `endTime` | `HH:mm` |
| `appointmentType` | string, possibly empty |
| `instructions` | string (same source as description) |
| `notes` | string from the Notes field; `""` when left blank |
| `locationStreet` | string |
| `locationCity` | string |
| `locationState` | string |
| `locationZipCode` | string |
| `locationGateCode` | string |
| `locationNavigation` | `""` or `Navigation Instructions: <text>` |

### PUT `/appointments/{id}` body

Same as POST except:

- no `clientId`
- adds `appointmentStatus`: `scheduled` | `completed` | `cancelled`

**Decided.** Merge. Keys absent from the body are left unchanged. `{ "appointmentStatus": "cancelled" }` is a valid body and changes status only.

### `AppointmentType`

| JSON | Type |
|---|---|
| `value` | string, required to be non-empty to be kept |
| `label` | string |

### `AppointmentDetail`

Built from `data` or the root. Every scalar is read with `toString()` and defaults to `""` or `0`. Null dates stay null.

| JSON | Type | UI |
|---|---|---|
| `id` | string | Yes |
| `description` | string | Yes, when non-empty (instructions/description section) |
| `scheduledDate` | string → date | Yes, UTC calendar day |
| `startTime`, `endTime` | string | Yes, as a 12-hour range |
| `duration` | int minutes | Parsed. The edit form prefers `endTime - startTime` over this field. |
| `appointmentType` | string | Yes, humanized |
| `appointmentStatus` | string | Yes, via `fromApi` |
| `instructions` | string | Fed into the edit form |
| `notes` | string | Shown when non-empty. The edit form loads this value and writes it back. A blank Notes field sends `""` and clears stored notes. |
| `checkInTime` | string → local DateTime | Shown when present |
| `checkOutTime` | string → local DateTime | Shown when present |
| `status` | string | Parsed. **Decided: unused.** Not the status chip. The chip uses `appointmentStatus`. The server may omit this field or send `""`. |
| `locationStreet`, `locationCity`, `locationState`, `locationZipCode` | string | Address line |
| `locationGateCode` | string | Shown when non-empty |
| `locationNavigation` | string | Shown when non-empty |
| `clientId`, `caregiverId` | string | Used to prefill edit |
| `carePlanId` | string or null | Parsed, not shown on the detail screen |
| `createdAt`, `updatedAt` | string → local DateTime | Parsed, not shown |
| `client` | object or null | `AppointmentParty` |
| `caregiver` | object or null | `AppointmentParty` |
| `tasks` | array | `AppointmentTask` |

### `AppointmentParty`

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `firstName`, `lastName` | string | |
| `phone`, `email` | string | |
| `emergencyContacts` | array | `EmergencyContact`: `id`, `name`, `relationship`, `phone`, `email`, `isPrimary` (bool, only `== true`) |
| `carePlans` | array | `AppointmentCarePlan`: `id`, `name`, `description`, `startDate`, `endDate`, `goals` (stringified), `notes`, `status` |

The detail screen’s party section shows name, phone, and email. Emergency contacts and care plans on the party are parsed. Whether the detail screen renders the nested care plans was not a separate API; they are available on the model. The visible sections confirmed in the screen are hero, info (type, status, time, check-in, check-out), client party, caregiver party, location, notes, and tasks.

### `AppointmentTask`

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | Falls back to `name` |
| `description` | string | |
| `isCompleted` | bool | True when `isCompleted == true` or `completed == true` |

These tasks are read-only on the admin detail screen. The app does not toggle them.

### `Caregiver` — GET `/users/caregivers` item

| JSON | Type | Notes |
|---|---|---|
| `id` | string | |
| `firstName`, `lastName` | string or null | Combined into `name` |
| `email` | string or null | Name fallback, and shown in the model |
| `phone` | string or null | Parsed. Dropdown shows `name` and `role`, not phone. |
| `role` | string, default `""` | **Decided:** the position label shown next to the name, not the auth role. Auth role on the account is `CAREGIVER`. |
| `avatar` | string or null | **Decided:** unused for now. Omit or send `null`. Not shown in the dropdown. |

There is no admin mobile screen that creates or edits a caregiver. **Decided:** positions are created in the admin web portal. The phone only displays `role`.

### `CaregiversListResponse` meta

Under `data.meta` when present: `page`, `pageSize`, `total`, `totalPages`, `hasNextPage`, `hasPreviousPage`. Missing meta yields defaults (`page` 1, `hasNextPage` false) and the items still load.

---

## Enums that affect payloads

| Name | Wire values the admin app writes | Notes |
|---|---|---|
| Gender | `male`, `female`, `other` | Read default `female` |
| Appointment status (write) | `scheduled`, `completed`, `cancelled` | Read set is wider. See table above. |
| Hazard type | `environmental_risks`, `medical_risks` | Create and update send `type` and `description` only. |
| Care plan status | `active`, `inactive`, `completed` | |
| Care category | not written by a live call | Read: `medical` vs anything else. Local enum also has `nonMedical`. |
| Visit frequency | not written by a live call | Read strings listed under `ServiceRequirementData`. |
| Priority | not written | Local only: `low`, `medium`, `high`. |
| Medication schedule | `OD`, `BD`, `TDS`, `QID`, `PRN`, `HS` | Plus any previously stored string the dropdown preserves. |

## Local-only models with no API

`DummyData` builds in-memory clients and appointments. Only `DummyData.appointments()` is still loaded, into `AppointmentController.appointments` at startup. The appointments **list screen** uses `appointmentList` from the API, not this dummy list. The dummy list matters when an edit route is opened with an id that was not first copied from `AppointmentDetail` via `upsertAppointmentFromDetail`. The normal detail → edit path does that copy.

`EditClientSheet` writes `Client` fields in memory through `updateClientDetails` and never calls the API. Nothing constructs `EditClientSheet`.
