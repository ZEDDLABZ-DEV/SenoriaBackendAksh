# 06 — Mobile Feature Workflows

Only features with source evidence are listed. Routes are in `lib/core/routes/app_routes.dart`.

| Route | Screen | Backend? |
|---|---|---|
| `/` | Splash | Token presence only |
| `/login` | Login | `POST /auth/login` |
| `/dashboard` | Home | `GET /appointments/caregiver/{id}` |
| `/all-appointments` | Filterable list | Same dashboard data. No extra call |
| `/clients` | Client list | `GET /clients/caregiver/{id}` |
| `/client-detail` | Client profile | `GET /clients/{id}` |
| `/care-plan-detail` | Read-only plan | Arguments only. No call |
| `/appointment-detail` | Visit | GET, check-in, complete, cancel |
| `/appointment-care-plan` | Checklist | Completion toggle |

State management is GetX. There is no second data source besides `ApiClient` and `DemoData`.

---

## 1. Splash and session restore

**CONFIRMED.** `SplashView._decideRoute`.

1. Wait ~1.3s.
2. If `access_token` is non-empty, open dashboard.
3. Otherwise open login.
4. Dashboard and clients then call the API. A dead token surfaces as 401, refresh, or forced logout.

No profile refresh endpoint exists.

---

## 2. Login

**CONFIRMED.** `LoginView` + `AuthController.login`.

1. Validate email and password locally.
2. `POST /auth/login` with email, password, and `role: "CAREGIVER"`.
3. Parse `data` as `LoginResponseModel`.
4. Reject non-caregiver roles and clear storage.
5. Save tokens and user. Greeting uses `firstName`.
6. Open dashboard.

**Failure:** snackbar, stay on login. See `04_authentication_and_permissions.md`.

**Not implemented:** forgot password, registration, biometric login.

---

## 3. Logout

**CONFIRMED.** Dashboard menu confirms, then local clear and `/login`.

**DECIDED:** the app still does not call logout. A refresh token remains valid until it expires after 30 days, is rotated by a later refresh, or the admin deactivates the user.

---

## 4. Dashboard

**CONFIRMED.** `DashboardController.fetchAppointments`.

1. Read `user.id`. If missing, show an error and skip the network.
2. `GET /appointments/caregiver/{id}`.
3. Render cards from `AppointmentModel`.
4. Counts are local: total list length, `appointmentStatus == scheduled`, and `isUpcoming` (scheduled date today or later).

Empty `data: []` shows "No appointments yet." API errors show `message` and a retry that calls the same GET.

**Pull-to-refresh (CONFIRMED):** `DashboardView` wraps the list in `RefreshIndicator` and calls `fetchAppointments` (`dashboard_view.dart` 43–45). The same call runs from the error retry, and from check-in, complete, and cancel when `DashboardController` is registered.

---

## 5. All appointments

**CONFIRMED.** `AllAppointmentsView`.

Uses the dashboard list already in memory. If the controller was disposed, the route binding creates it again and it refetches. Each tab's `RefreshIndicator` calls `fetchAppointments` again (`all_appointments_view.dart` 147–149). That is the same unpaginated GET. Search text is not sent.

| Control | Behavior | Server parameter |
|---|---|---|
| Search | Local contains-match on client name, humanized type, address, description | None |
| Scheduled tab | `appointmentStatus` is `scheduled` | None |
| Completed tab | `appointmentStatus` is `completed` | None |
| Cancelled tab | `appointmentStatus` is `cancelled` or `canceled` | None |

Card chip prefers `completedToday` ("Completed today"), otherwise `dailyVisitStatus`.

Opening a card passes the `AppointmentModel` into appointment detail, which still refetches by id.

---

## 6. Clients list

**CONFIRMED.** `ClientsController`.

1. Page 1 on open.
2. Query `page`, `pageSize=10`, `status=active`, and `search` when the box is non-empty.
3. Search is debounced 400 ms and resets to page 1.
4. Scroll within 200 px of the bottom loads `page+1` if `meta.hasNextPage`.
5. Append results. Do not replace page 1.
6. Pull-to-refresh calls `fetchClients`, which resets to page 1 (`clients_view.dart` 18–20).

**Empty search with zero rows:** "No clients yet." **Search miss:** "No clients found." **Error:** message plus retry.

**DECIDED:** `search` matches first and last name. The hint string is "Search clients by name." Another caregiver's list id returns 404. A client can be assigned to many caregivers; this list still contains only the signed-in caregiver's assignments.

---

## 7. Client detail

**CONFIRMED.** `ClientDetailController`.

Arguments are either a `ClientModel` (shown immediately, then replaced by the GET) or a raw id string.

`GET /clients/{id}` replaces the model.

Sections that render server fields:

| Section | Fields |
|---|---|
| General / client details | name, age from `dateOfBirth`, gender, phone, email, notes, status, address |
| Emergency contacts | `emergencyContacts` |
| Diagnoses & allergies | `diagnoses` including allergy-like rows |
| Languages | `languages`, primary flag |
| Hazards | `hazards` grouped by `type` |
| Care plans | `carePlans` summary. Tap opens read-only detail with the object in memory |
| Appointments | `appointments` summaries. `doctor_visit` shows doctor, specialty, phone, clinic |

Service requirements are not on this screen's model.

Care-plan detail (`CarePlanDetailView`) shows goals, tasks, medications, diet, and hygiene, including `completedToday` as a read-only "Done today" / "Pending" label. It does not toggle.

---

## 8. Appointment detail

**CONFIRMED.** `AppointmentDetailController` and `appointment_detail_view.dart`.

1. Show the passed appointment immediately if present.
2. `GET /appointments/{id}`.
3. Render schedule, both statuses, instructions, notes, flat location, embedded client, languages, hazards, service requirements, and care plans.
4. Diagnoses block on this screen is a static unavailable placeholder. It does not call an API.

### Date lock (CONFIRMED, device local calendar)

If `scheduledDate` is after today:

- Gate code shows "Available on the visit day" instead of `locationGateCode`.
- Care plans open read-only (`/care-plan-detail`).
- Check-in is hidden.
- Complete button would be disabled with "You can't complete this appointment before its scheduled date." The action bar is also hidden until check-in, so this hint matters once the bar is visible.

If `scheduledDate` is null, `isFutureDate` is false, so the lock does not apply.

### Check-in workflow (CONFIRMED client, INFERRED server)

Shown per care plan when the daily visit is open and the date is not in the future.

1. Caregiver confirms "Start this visit?".
2. App reads GPS. Permission or service failure stops here.
3. `POST /care-plans/{carePlanId}/check-in` with UTC `timestamp`, `location`, and local `date`. The commented body does not include `appointmentId`. The request does not send `X-Timezone`.
4. App stores `checkInsByPlan[carePlanId] = now` in memory.
5. App ignores the response body, then refetches the appointment and the dashboard list.
6. Checklist for that plan becomes editable.
7. Action bar appears because `isCheckedIn` is now true (memory or a non-empty `checkInTime`) and `isDailyVisitOpen` is true.

**DECIDED:** check-in sets `checkInTime` and leaves `dailyVisitStatus` as `pending`. `completedToday` stays false. `activeToday` must already be true. `pending` keeps `isDailyVisitOpen` true, so the bar appears from `checkInTime` alone. Do not set `in_progress`. Further care-plan check-ins on the same visit can be stored without clearing `checkInTime`.

**DECIDED response:** `data` is the full appointment. The screen uses the refetch, not that body.

**Appointment identity:** when `appointmentId` is absent, attach the check-in only to the single matching visit described in `02_api_inventory.md`. More than one match is 422. The current app cannot distinguish those visits until it sends `appointmentId`.

**Failure:** snackbar with `ApiException.message` or the location message. Memory is not updated because the assignment happens after the request in the commented code.

### Checklist workflow (CONFIRMED)

Editable route: `/appointment-care-plan` with a `CarePlanModel` argument. Opened only after that plan is in `checkInsByPlan`.

1. Seed checks from each item's `completedToday`.
2. Tap toggles optimistically.
3. `POST /care-plans/{id}/completions/toggle` with `itemType`, `itemId`, and today's local `date`.
4. If response `completed` is a bool, force the checkbox to it.
5. On error, revert.
6. Popping the checklist refetches the appointment so "all items done" can enable the complete button.

`itemType` values: `task`, `medication`, `diet`, `hygiene`.

**DECIDED:** the item really toggles. A second tap returns `completed: false`, and the next read returns `completedToday: false` for that item on that date. `completedToday` is computed for Vancouver when `X-Timezone` is absent.

### Complete the day (CONFIRMED client gates)

Action bar is visible when:

- appointment status is not cancelled, and
- `isDailyVisitOpen` (`activeToday`, not `completedToday`, daily status not `cancelled`, `canceled`, or `missed`), and
- `isCheckedIn` (non-empty `checkInTime`, or the in-memory per-plan map) or daily status is `in_progress` / `ongoing`. After the decided check-in, `pending` plus `checkInTime` is enough.

Complete stays disabled until `allCarePlanItemsCompleted` and the scheduled day is not in the future.

1. Dialog asks for a completion date. Default is now.
2. `POST /appointments/{id}/daily-completion/toggle` with `{ "date": "YYYY-MM-DD" }`.
3. Body ignored. Refetch appointment and dashboard.

**DECIDED result of the refetch:** `completedToday: true` only when that `date` is the current day in `X-Timezone` or, for this app, `America/Vancouver`. `dailyVisitStatus: "completed"`, `activeToday: false`, and `checkOutTime` set. `appointmentStatus` stays `scheduled` until every day in the range is completed, or an admin marks the whole appointment completed. A repeat request does not undo the day. The response body is `{ "appointmentId", "date", "completed": true }` and is ignored.

The complete button's enabled state uses care-plan flags and future-date, while the bar's visibility uses daily flags. After a successful complete, `isDailyVisitOpen` becomes false and the bar hides. The Completed tab uses `appointmentStatus`, not `completedToday`. A multi-day visit can be done for today and still sit on the Scheduled tab. That matches the model comment at `appointment_model.dart` 259–261.

Reject completion when that date's checklist items are incomplete, the date is outside the appointment range, or the visit is cancelled. The phone does not send the item list, so the server reads stored completions. The button disable is only a client gate.

### Cancel (CONFIRMED client, incompatible with the required reason)

1. Dialog requires a non-empty reason.
2. Commented request body is only `{ "appointmentStatus": "cancelled" }`. The reason argument is passed to `DemoData` and is not in the JSON.
3. If response `data` has `id`, parse it as the appointment. Otherwise GET the appointment.
4. Refresh the dashboard.
5. Cancelled appointments hide the action bar.

**DECIDED:** the server requires `cancellationReason` and rejects the current body with 422. There is no safe way to recover the typed reason on the server. The response, once the body includes the reason, is the full appointment with `appointmentStatus: "cancelled"`, that reason, `dailyVisitStatus: "cancelled"`, and `activeToday: false`. Caregiver PUT is cancel only. Any other `appointmentStatus` is rejected.

---

## 9. Relationships

```text
User (caregiver)
  └── assignments ── Client
                       ├── languages, contacts, diagnoses, hazards, service requirements
                       ├── care plans ── tasks, medications, diet, hygiene
                       │                  └── completions by date
                       └── appointments ── daily visits by date
                                          └── optional carePlanId
```

**CONFIRMED:** appointment `clientId` and embedded `client.id` should match. `caregiverId` should match the logged-in user for every row the list returns.

**DECIDED:** `carePlanId` does not restrict check-in. The UI offers every embedded `client.carePlans` entry, and the server allows check-in for any of those plans. Another caregiver's client, appointment, or care plan returns 404. Languages, hazards, diagnoses, and appointment types use the closed lists in `03_data_models.md`. The value `other` is humanized to `Other`. The admin note is not on these payloads.

---

## 10. Conditional behavior matrix

| Condition | App behavior | Server should |
|---|---|---|
| 401 then refresh succeeds | Retry once, user stays in the screen | Issue a new JWT and a new opaque refresh token. `expiresIn` is `86400` |
| 401 then refresh fails | Login, session snackbar | 401 on the bad refresh |
| 403 / 404 / 422 / 5xx | Show `message` | Send `message` |
| Clients payload not an object | Empty list, no error | Always send the `{ data, meta }` object |
| Appointment list not an array | Generic error | Always send an array in `data` |
| Future `scheduledDate` | Hide gate code, read-only care plan | Still return the gate code. The app hides it |
| No care plans | Check-in unavailable copy | `carePlans: []` is valid |
| Item toggle error | Checkbox reverts | Non-2xx with `message` |

---

## 11. Features absent from the source

Do not build these as mobile contract requirements:

- Registration
- Profile edit
- Image upload
- Push notifications
- Payments or invoicing
- Reports
- Settings beyond logout
- Server-side appointment search or sort
- A care-plan GET by id
- Logout, forgot-password, and reset-password calls

Admin-only versions of client and schedule management are proposals in `07_admin_portal_specification.md`.
