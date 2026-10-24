# Caregiver API

Base path: `/api/v1`.

Headers on caregiver calls:

```text
Content-Type: application/json
Accept: application/json
Authorization: Bearer <accessToken>   # authenticated routes only
X-Timezone: <IANA name>               # optional
```

There are no cookies. When `X-Timezone` is missing or is not a valid IANA name, calendar-day calculations use `America/Vancouver`. The zone is never inferred from a UTC timestamp.

Success:

```json
{ "message": "string", "data": {} }
```

Error:

```json
{
  "message": "string",
  "code": "string, optional",
  "errors": { "field": ["string"] }
}
```

`message` and `code` are strings when present. Ids are UUID strings. Dates are `YYYY-MM-DD`. Appointment clock times are `HH:mm`.

`GET /health` is outside this prefix and returns `{ "status": "ok", "database": "up" }`.

## POST /auth/login

No bearer token. Body:

```json
{ "email": "caregiver@example.com", "password": "example-password", "role": "CAREGIVER" }
```

`role` must be the exact string `CAREGIVER`. Any other role is **403** `ROLE_NOT_ALLOWED` and no tokens are issued. An administrator password on this route is also 403.

200 `data`:

| Field | Type |
|---|---|
| `user.id` | string |
| `user.email` | string |
| `user.firstName` | string |
| `user.lastName` | string |
| `user.role` | `CAREGIVER` |
| `user.avatar` | string or null |
| `user.permissions` | `[]` |
| `accessToken` | JWT, 24 hours |
| `refreshToken` | opaque, 30 days |
| `expiresIn` | `86400` |

Wrong email, wrong password, or an inactive user: **401** `INVALID_CREDENTIALS`. Invalid email or a password shorter than 6 characters: **422** with `errors`.

## POST /auth/refresh

No bearer token. Body: `{ "refreshToken": "<opaque>" }`.

200 `data`: new JWT `accessToken`, new opaque `refreshToken`, `expiresIn` `86400`. The previous refresh token is revoked. Presenting a revoked token returns **401** `REFRESH_EXPIRED` and revokes the rest of that login's refresh-token family. Unknown, expired, and deactivated-user tokens are 401.

## GET /appointments/caregiver/{caregiverId}

Bearer caregiver token. `{caregiverId}` must be the token subject. Any other id is **404**, whether or not that user exists.

200 `data` is an array of appointment objects. There is no `meta` wrapper. An empty assignment list is `data: []`.

Each appointment includes `appointmentStatus` and `status` (`active` or `inactive`), flat `location*` fields including `locationGateCode`, `completedToday`, `activeToday`, `dailyVisitStatus`, embedded `client` (languages, hazards, emergency contacts, service requirements, care plans) and `caregiver` (`firstName`, `lastName`, `phone`, `email`). Diagnoses are not on this embed. Admin-only `other` notes are not included. The value `other` is returned as `other`.

`completedToday` is true only for the current calendar day in the request timezone. A visit finished on an earlier day returns `completedToday: false` and `dailyVisitStatus: "completed"`. A future scheduled day returns `activeToday: false`. The gate code is still present.

## GET /appointments/{id}

One appointment object, same shape as a list element. Another caregiver's appointment, or an unknown id, is **404**.

## PUT /appointments/{id}

Cancel only. Required body:

```json
{ "appointmentStatus": "cancelled", "cancellationReason": "Family requested a different day." }
```

The current caregiver app omits `cancellationReason`. That body is **422** and the appointment stays scheduled. Any `appointmentStatus` other than `cancelled` is **422**. A blank reason is **422**.

200 `data` is the full appointment with `appointmentStatus: "cancelled"`, the trimmed reason, `dailyVisitStatus: "cancelled"`, `activeToday: false`, and `status` still `active` or `inactive`. Another caregiver's id is **404**.

## POST /appointments/{id}/daily-completion/toggle

Body: `{ "date": "YYYY-MM-DD" }`.

200 `data`: `{ "appointmentId", "date", "completed": true }`. A repeat for the same appointment and date stays completed and does not clear the day.

The following GET shows `completedToday: true` only when `date` is the current day in the request timezone, `dailyVisitStatus: "completed"`, `activeToday: false`, and a `checkOutTime`. `appointmentStatus` stays `scheduled` until every day from `scheduledDate` through `endDate` is completed.

422 when the date is outside the appointment range, the date is after the request timezone's today, the appointment is cancelled, or any care-plan item on that client is still incomplete for that date. A care plan with no items can be completed. Another caregiver's appointment is **404**.

While a visit is offered for coverage, the appointment object also includes `coverageRequest`: `{ id, reason, requestedById, createdAt }`. Otherwise `coverageRequest` is `null`.

## POST /appointments/{id}/coverage

Bearer caregiver token. The caller must own the visit. Body:

```json
{ "reason": "I am unwell and cannot attend." }
```

`reason` is required, trimmed, and at most 500 characters. A missing or blank reason is **422**.

This offers that one visit to every other **active** caregiver. The visit stays on the requester until someone accepts it. Each other caregiver gets a notification of type `appointment_coverage_requested`. Administrators and inactive caregivers are not notified.

200 `data`:

| Field | Type |
|---|---|
| `notifiedCount` | number |
| `release` | the offer: `id`, `appointmentId`, `status` (`open`), `reason`, `createdAt`, `resolvedAt` (null), `requestedBy`, `acceptedBy` (null) |
| `appointment` | the full appointment, still assigned to the requester, with `coverageRequest` set |

**409** when the visit is cancelled, completed, already started or checked in, already past, already offered, or has no date. Another caregiver's visit, or an unknown id, is **404**.

## POST /appointments/{id}/coverage/withdraw

Bearer caregiver token. No body. The owner takes the offer back. Other caregivers' notifications change to type `appointment_coverage_withdrawn`. The visit stays with the owner.

200 `data` is `{ release, appointment }` with `release.status` `withdrawn`. **409** when the visit is not currently offered. **404** for a visit the caller does not own.

## GET /appointment-coverage/open

Bearer caregiver token. 200 `data` is an array of open offers from other caregivers. Each item has `id`, `appointmentId`, `status`, `reason`, `createdAt`, `requestedBy` (`id`, `firstName`, `lastName`, `phone`), and `appointment` (`description`, dates, `startTime`, `endTime`, `appointmentType`, street address, and `client` name). The caller's own offers are not included. An empty board is `[]`.

## GET /appointment-coverage/mine

Bearer caregiver token. 200 `data` is the caller's own open offers, same shape as the open board.

## GET /appointment-coverage/{id}

Bearer caregiver token. `{id}` is the coverage request id, not the appointment id.

While the offer is open, any caregiver can read it. 200 `data` is `{ release, appointment }`. `appointment` is the full visit payload from `GET /appointments/{id}`: client, care plans, tasks, hazards, emergency contacts, location (including `locationGateCode`), instructions, notes, and services.

After it is accepted, the requester and the caregiver who took it can still read that payload. Anyone else gets **409** `This visit has already been taken`. A withdrawn offer is **409** `This coverage request was withdrawn`. A closed offer is **409** `This visit is no longer available`. An unknown id is **404**.

## POST /appointment-coverage/{id}/accept

Bearer caregiver token. No body. The first caregiver to accept is assigned the visit. The response is **200** `{ release, appointment }` with `release.status` `accepted`, `release.acceptedBy` set, and `appointment.caregiverId` equal to the accepter. `appointment` is the full visit. The accepter is also assigned to that client, so check-in and the care plan work. A visit that belongs to a series is marked as an exception so a later series edit does not move it back.

The requester is notified with type `appointment_coverage_accepted`. The accepter's notification becomes `appointment_coverage_assigned`. Every other caregiver who was notified is updated to `appointment_coverage_taken`.

**409** `You cannot accept your own visit` for the requester. **409** when the offer was withdrawn, closed, or already accepted. **422** when the accepter already has an overlapping visit (`conflicts` lists them). Time off and hours outside the accepter's availability do not block acceptance. A visit that has already started is closed and returns **409**.

## GET /notifications

Bearer caregiver token. Optional query `unread=true` or `unread=false`. Any other value is **422**.

200 `data`:

| Field | Type |
|---|---|
| `unreadCount` | number of unread notifications for this caregiver |
| `notifications` | the latest 100, newest first |

Each notification has `id`, `type`, `title`, `body`, `releaseId`, `appointmentId`, `readAt` (ISO string or null), and `createdAt`. Open `releaseId` in `GET /appointment-coverage/{releaseId}` to read the visit before accepting.

## POST /notifications/{id}/read

Bearer caregiver token. Marks that notification read. 200 `data` is the notification. Another caregiver's id, or an unknown id, is **404**. Reading it again keeps the first `readAt`.

## POST /notifications/read-all

Bearer caregiver token. 200 `data` is `{ updatedCount }`.

## POST /notification-devices

Bearer caregiver token. Registers this phone for visit-coverage pushes. Body:

```json
{ "token": "<FCM registration token>", "platform": "ios" }
```

`platform` is `ios` or `android`. `token` is required and trimmed. 200 `data` is `{ id, token, platform, caregiverId }`. Registering the same token again updates that row and points it at the current caregiver. One token belongs to one caregiver.

422 when `token` or `platform` is missing, `token` is blank, or `platform` is not `ios` or `android`. Field errors are `errors.token` and `errors.platform`.

## DELETE /notification-devices

Bearer caregiver token. Body: `{ "token": "<FCM registration token>" }`.

200 `data` is `{ "deleted": true }` when this caregiver owned the token. An unknown token, or a token owned by someone else, is `{ "deleted": false }`. Logout also deletes every token for that account. Deactivating a caregiver does the same.

A push is sent only after an in-app notification row is saved. The title and body match that row. The data payload is strings: `type`, `notificationId`, `releaseId` (empty when null), `appointmentId` (empty when null), `title`, and `body`. `releaseId` is the coverage id. A missing Firebase configuration or a push failure does not change the coverage response. An FCM token Firebase reports as unregistered or invalid is deleted.

## GET /clients/caregiver/{caregiverId}

Query: `page`, `pageSize` (1–100), `status` (`active` or `inactive`), optional `search`.

200 body:

```json
{
  "message": "ok",
  "data": {
    "data": [],
    "meta": {
      "total": 0,
      "page": 1,
      "pageSize": 10,
      "totalPages": 0,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

`meta` numbers are JSON numbers and the two `has*` fields are JSON booleans. Search matches first name, last name, the full name, phone, and email, case-insensitively. Only clients assigned to the token subject are returned. Another caregiver id is **404**. Invalid query values are **422**.

List objects include identity and display fields. The detail route returns the nested profile.

## GET /clients/{id}

One client. Nested `address`. Includes `languages`, `emergencyContacts`, `diagnoses`, `hazards`, `carePlans`, and `appointments`. `serviceRequirements` are not on this object. `doctor_visit` summaries include `doctorName`, `doctorSpecialty`, `doctorPhone`, and `clinicName`. Other visit summaries omit those keys. Appointments on this payload are the ones assigned to the requesting caregiver. A client that is not assigned to that caregiver is **404**.

`completedToday` on care-plan items is the completion state for the request timezone's current day.

## POST /care-plans/{carePlanId}/check-in

Body the current app sends:

```json
{
  "timestamp": "2026-10-19T16:05:00.000Z",
  "location": { "latitude": 49.1913, "longitude": -122.849 },
  "date": "2026-10-19"
}
```

`appointmentId` is optional. The current app does not send it.

When it is absent, the backend looks at this caregiver's `scheduled`, `active` appointments for the care plan's client that cover `date`. Zero matches is **422** when the care plan belongs to this caregiver. A caregiver can have several visits with the same client on one day (for example 11:00 and 17:00). In that case the earliest visit that is not yet checked in, completed, cancelled, or missed is used. When every visit that day is already checked in or closed, the response is **422** and nothing is written. A care plan the caregiver is not assigned to is **404**, including when the id does not exist.

When `appointmentId` is present, that appointment is used after the same ownership checks. Another caregiver's appointment id is **404**.

Check-in is rejected when the date is in the future, outside the appointment range, or that day's visit is already completed, cancelled, or missed. It does not filter on `appointment.carePlanId`. Any care plan on that client can be checked in.

200 `data` is the full appointment. `checkInTime` is set, `dailyVisitStatus` stays `pending`, `activeToday` is true when that date is today, and `completedToday` stays false. The service date is the `date` field, not the calendar day of `timestamp`.

## POST /care-plans/{carePlanId}/completions/toggle

Body:

```json
{ "itemType": "task", "itemId": "<uuid>", "date": "YYYY-MM-DD" }
```

`itemType` is `task`, `medication`, `diet`, or `hygiene`.

200 `data` is `{ "completed": true }` or `{ "completed": false }`. A second call for the same item and date flips the value. The next read's `completedToday` matches that value when `date` is the current day in the request timezone.

The care plan must be assigned to the caregiver (**404** otherwise). The item must belong to that plan (**422** otherwise). A check-in for that care plan, caregiver, and date is required (**422** otherwise).

## POST /admin/auth/login

Body: `{ "email", "password" }`. The user must have role `ADMIN` and status `active`. 200 `data` matches the caregiver login shape with `role: "ADMIN"` and `permissions: []`. A caregiver account is **403**. This token's refresh uses `POST /auth/refresh`.

Other `/api/v1/admin/*` paths require an administrator token and currently return **404**. A caregiver token on those paths is **403**.

## Closed values

| Domain | Values |
|---|---|
| Gender | `female`, `male`, `other` |
| Proficiency | `native`, `fluent`, `intermediate`, `basic`, `other` |
| Severity | `low`, `moderate`, `high`, `other` |
| Hazard type | `fall_risk`, `other` |
| Appointment type | `personal_care`, `wellness_check`, `companionship`, `medication_support`, `doctor_visit`, `other` |
| Appointment status | `scheduled`, `completed`, `cancelled` |
| Record `status` | `active`, `inactive` |

When a stored value is `other`, the admin note stays in the database and is omitted from every caregiver response.
