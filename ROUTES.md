# API routes

Base path: `/api/v1`. JSON is camelCase. Success bodies use `{ success, message, data, timestamp, requestId }`. Errors use both `message`/`code`/`errors` and `error.message`/`error.code`/`error.fields`.

`GET /health` is outside this prefix and stays `{ status, database }`.

## Caregiver unchanged

| Method | Path | Who |
| --- | --- | --- |
| POST | `/auth/forgot-password` | public, already present |
| POST | `/auth/reset-password` | public, already present |
| GET | `/appointments/caregiver/{caregiverId}` | CAREGIVER, already present |
| POST | `/appointments/{id}/daily-completion/toggle` | CAREGIVER, already present |
| GET | `/clients/caregiver/{caregiverId}` | CAREGIVER, already present |
| POST | `/care-plans/{carePlanId}/check-in` | CAREGIVER, already present. Location body is optional. |
| POST | `/care-plans/{carePlanId}/completions/toggle` | CAREGIVER, already present |
| POST | `/appointments/{id}/coverage` | CAREGIVER owner. Body `{ reason }`. Notifies every other active caregiver. The visit stays with the owner until someone accepts. |
| POST | `/appointments/{id}/coverage/withdraw` | CAREGIVER owner. Takes an open offer back. |
| GET | `/appointment-coverage/open` | CAREGIVER. Open offers from other caregivers. |
| GET | `/appointment-coverage/mine` | CAREGIVER. The caller's open offers. |
| GET | `/appointment-coverage/{id}` | CAREGIVER. Full visit details. `{id}` is the coverage request. |
| POST | `/appointment-coverage/{id}/accept` | CAREGIVER. First accept transfers the visit and assigns the client. |
| GET | `/notifications` | CAREGIVER. Optional `unread=true`. |
| POST | `/notifications/{id}/read` | CAREGIVER. |
| POST | `/notifications/read-all` | CAREGIVER. |
| POST | `/notification-devices` | CAREGIVER. Body `{ token, platform }` where platform is `ios` or `android`. Upserts that FCM token onto the current caregiver. |
| DELETE | `/notification-devices` | CAREGIVER. Body `{ token }`. Logout and caregiver deactivation also remove that account's tokens. |

## Shared and extended

| Method | Path | Who | Change |
| --- | --- | --- | --- |
| POST | `/auth/login` | public | Already present. Role in the body is ignored. Returns the stored role inside `data`, with `expiresIn: 3600`. ADMIN, CAREGIVER, and SALES use this path. |
| POST | `/auth/refresh` | public | Already present. Returns a new access token and `expiresIn: 3600`. Omits `refreshToken`. The refresh token is not rotated. |
| POST | `/auth/logout` | CAREGIVER, ADMIN, or SALES | Already present. Revokes that account's refresh tokens. |
| GET | `/clients/{id}` | CAREGIVER (assigned) or ADMIN | Already present. Caregiver fields kept. Adds `serviceRequirements`. |
| GET | `/appointments/{id}` | CAREGIVER (owner) or ADMIN | Already present. Caregiver fields kept. Adds `tasks` from the client's care plan. `status` remains the record status. |
| PUT | `/appointments/{id}` | CAREGIVER or ADMIN | Already present. Caregiver body `{ appointmentStatus: "cancelled" }` changes status only. Admin body is a merge and can set schedule, caregiver, type, notes, location, status, and `serviceIds`. |

`POST /admin/auth/login` was already present. It stays an ADMIN-only alias. A caregiver token still receives 403 and no tokens.

## Admin added

All of these require an access token whose account role is ADMIN.

| Method | Path | Status |
| --- | --- | --- |
| GET | `/dashboard/stats` | added |
| GET | `/clients` | added |
| POST | `/clients` | added |
| PUT | `/clients/{id}` | added |
| DELETE | `/clients/{id}` | added. Hard delete. |
| GET | `/clients/{clientId}/hazards` | added |
| POST | `/clients/{clientId}/hazards` | added |
| PUT | `/clients/{clientId}/hazards/{hazardId}` | added |
| DELETE | `/clients/{clientId}/hazards/{hazardId}` | added |
| POST | `/clients/{clientId}/service-requirements` | added |
| PUT | `/clients/{clientId}/service-requirements/{requirementId}` | added |
| DELETE | `/clients/{clientId}/service-requirements/{requirementId}` | added |
| POST | `/care-plans` | added. One plan per client. |
| PUT | `/care-plans/{carePlanId}` | added |
| DELETE | `/care-plans/{carePlanId}` | added |
| POST | `/care-plans/{carePlanId}/tasks` | added |
| PUT | `/care-plans/{carePlanId}/tasks/{taskId}` | added |
| DELETE | `/care-plans/{carePlanId}/tasks/{taskId}` | added |
| POST | `/care-plans/{carePlanId}/medications` | added |
| PUT | `/care-plans/{carePlanId}/medications/{medicationId}` | added |
| DELETE | `/care-plans/{carePlanId}/medications/{medicationId}` | added |
| POST | `/care-plans/{carePlanId}/diet` | added |
| PUT | `/care-plans/{carePlanId}/diet/{dietId}` | added |
| DELETE | `/care-plans/{carePlanId}/diet/{dietId}` | added |
| POST | `/care-plans/{carePlanId}/hygiene` | added |
| PUT | `/care-plans/{carePlanId}/hygiene/{hygieneId}` | added |
| DELETE | `/care-plans/{carePlanId}/hygiene/{hygieneId}` | added |
| GET | `/appointments` | added |
| POST | `/appointments` | added |
| GET | `/appointments/types` | added |
| DELETE | `/appointments/{id}` | added |
| GET | `/doctor-appointments` | added. Portal list. Query: `page`, `pageSize`, `search`, `clientId`, `status`. |
| POST | `/doctor-appointments` | added. Separate from caregiver visits. |
| GET | `/doctor-appointments/client/{clientId}` | added. ADMIN, or a CAREGIVER assigned to that client. |
| GET | `/doctor-appointments/{id}` | added. ADMIN, or a CAREGIVER assigned to the client. |
| PUT | `/doctor-appointments/{id}` | added |
| DELETE | `/doctor-appointments/{id}` | added |
| GET | `/doctor-appointment-types` | added. Dropdown for a doctor's appointment. |
| POST | `/doctor-appointment-types` | added |
| PUT | `/doctor-appointment-types/{id}` | added |
| DELETE | `/doctor-appointment-types/{id}` | added. Refused while an appointment uses it. |
| GET | `/users/caregivers` | added. `role` on each row is the job position. |
| POST | `/users/caregivers` | added |
| POST | `/users/caregivers/{id}/deactivate` | added |
| POST | `/users/caregivers/{id}/password` | added. Admin sets a caregiver password. Signs that caregiver out. |
| GET | `/users/sales` | added. Sales accounts, active and inactive. Optional `status`: `all` (default), `active`, or `inactive`. Each row includes `status`. |
| POST | `/users/sales` | added. Body: `firstName`, `lastName`, `dateOfBirth`, `email`, `password`, `phone`. |
| POST | `/users/sales/{id}/deactivate` | added. Marks the account inactive and ends its sessions. |
| POST | `/users/sales/{id}/password` | added. Admin sets a sales password and ends its sessions. |
| POST | `/users/sales/{id}/sessions/revoke` | added. Ends current sessions and leaves the account active. |
| GET | `/caregiver-positions` | added. Caregiver type dropdown. |
| POST | `/caregiver-positions` | added |
| PUT | `/caregiver-positions/{id}` | added. Renaming updates caregivers who use that type. |
| DELETE | `/caregiver-positions/{id}` | added. Refused while a caregiver uses it. |
| GET | `/services` | added. Visit service dropdown. |
| POST | `/services` | added |
| PUT | `/services/{id}` | added. Appointments keep the renamed service. |
| DELETE | `/services/{id}` | added. Refused while an appointment uses it. |
| GET | `/admin/reports/visits` | added. Visit report. Query: `period` (`daily`, `weekly`, `monthly`, `custom`), `date`, `from`, `to`, `caregiverId`, `clientId`, `status` (`completed`, `pending`, `missed`, `cancelled`, `all`), `page`, `pageSize`. |
| GET | `/admin/reports/visits/export.pdf` | added. Same filters as the visit report. Returns `application/pdf`. |
| POST | `/admin/reports/visits/{dailyVisitId}/hours` | added. Appends an admin hour correction for one completed day. Body: `adjustedHours`, `reason`. |

## Integrations

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/integrations/status` | ADMIN or SALES | Each of `meta`, `ringcentral`, `zoho`, and `outlook` is `{ enabled, configured }`. With flags off and secrets empty, every vendor is disabled. See `docs/INTEGRATIONS.md`. |
| GET | `/webhooks/meta/leads` | public | Meta hub challenge. Returns `hub.challenge` as text when `hub.verify_token` matches `META_WEBHOOK_VERIFY_TOKEN`. |
| POST | `/webhooks/meta/leads` | public | Meta leadgen webhook. Verifies `X-Hub-Signature-256` with `META_APP_SECRET`. Creates a lead only when Meta is enabled. |
| POST | `/webhooks/zoho/leads` | public | Zoho lead webhook. No bearer token. Requires `X-Zoho-Webhook-Secret`. Creates a lead only when `ZOHO_INBOUND_ENABLED=true`. |
| POST | `/leads/{id}/calls/start` | ADMIN or owning SALES | RingCentral RingOut. When RingCentral is off, `200` with `data.started` false and `reason` `ringcentral_not_configured`. Does not log a call. See `docs/INTEGRATIONS.md`. |
| POST | `/webhooks/ringcentral/calls` | public | RingCentral call-log webhook. Echoes `Validation-Token`. Writes a call only when RingCentral is enabled. |
| POST | `/sales/meetings/{id}/outlook` | ADMIN or owning SALES | Pushes the meeting to the Outlook mailbox. When Outlook is off, `200` with `data.synced` false and `reason` `outlook_not_configured`. A Graph error stays `200` with `reason` `outlook_sync_failed` and does not remove the meeting. See `docs/INTEGRATIONS.md`. |

## Sales

Requires an access token whose account role is SALES. A sales token cannot call admin or caregiver routes. `POST /admin/auth/login` rejects a sales account.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sales/dashboard` | The signed-in salesperson's profile: `id`, `firstName`, `lastName`, `dateOfBirth`, `email`, `phone`, `role`. |

## Caregiver schedule (ADMIN)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/schedule` | Query: `from`, `to` (at most 31 days), optional `caregiverIds` (comma-separated, up to 50; default all active caregivers). One entry per caregiver per day with `visits`, `availability`, `timeOff`, `freeSlots`, `bookedMinutes`, `availableMinutes`, `freeMinutes`. Each visit has `visitStatus`: `scheduled`, `in_progress`, `completed`, `missed`, or `cancelled`. Cancelled visits are included. |
| GET | `/schedule/summary` | Query: `month` (`YYYY-MM`), optional `caregiverIds`. Per-day counts and minutes for the month grid. |
| GET | `/users/caregivers/{id}/availability` | Weekly working hours: `windows: [{ weekday, startTime, endTime }]`. `weekday` is 0 (Sunday) to 6 (Saturday). |
| PUT | `/users/caregivers/{id}/availability` | Replaces all windows. Several windows per day are allowed (split shifts) but cannot overlap. An empty list means "not configured", so no hours warnings are raised. |
| GET | `/users/caregivers/{id}/time-off` | Optional `from`, `to`. |
| POST | `/users/caregivers/{id}/time-off` | Body: `startDate`, optional `endDate`, optional `startTime` + `endTime` (omit both for a full day), `reason`. Booked visits are not cancelled; they are returned in `affectedVisits`. |
| DELETE | `/users/caregivers/{id}/time-off/{timeOffId}` | |
| GET | `/visit-series` | Optional `caregiverId`, `clientId`, `status` (`active`, `ended`). |
| POST | `/visit-series` | Recurring visits. Body: `clientId`, `caregiverId`, `startDate`, `endDate` (range up to 92 days, cannot start in the past), `weekdays` (default every day), `timeSlots: [{ startTime, endTime }]` (1–6 per day, may not overlap, e.g. 11:00–12:00 and 17:00–18:00), plus the usual visit fields and `serviceIds`. Location defaults to the client's address. Creates one appointment per date and time slot. Returns `series`, `createdCount`, `skipped`, `warnings`. |
| GET | `/visit-series/{id}` | Series plus `occurrences`. |
| PUT | `/visit-series/{id}` | Changes this and future visits from `fromDate` (default today or the series start). Can change `caregiverId`, `endDate`, `weekdays`, `timeSlots`, services, and visit fields. Visits that were edited individually, checked in, completed, or cancelled are kept. Deleted visits are not recreated. |
| DELETE | `/visit-series/{id}` | Optional `fromDate`. Removes not-yet-started visits from that date and marks the series `ended`. Past and checked-in visits are kept. |

Booking rules shared by `POST/PUT /appointments` and `/visit-series`:

- A caregiver cannot have two visits that overlap in time (**422**, with `conflicts`). Back-to-back visits and several visits with the same client on one day are allowed.
- For a series, send `skipConflicts: true` to create the rest and get the clashing ones back in `skipped`.
- A visit outside the caregiver's availability or during time off is **409** `SCHEDULE_WARNING` with `warnings` (`outside_hours` or `time_off`). Resend with `acknowledgeWarnings: true` to book anyway.
- Editing one visit of a series through `PUT /appointments/{id}` marks it as an exception. Deleting one through `DELETE /appointments/{id}` excludes that date and time slot from the series.

Item completion stays on `POST /care-plans/{carePlanId}/completions/toggle`. There is no second completion route. The hour correction does not change `checkInAt` or `checkOutAt`.

Coverage offers are caregiver to caregiver. The visit stays with the requester until `POST /appointment-coverage/{id}/accept`. Acceptance is refused when it would overlap another visit. Time off and working hours do not block it. Check-in, completion, cancellation, withdrawal, and an admin change or delete close the offer and update the other caregivers' notifications. Accepting a series visit marks that visit as an exception.
