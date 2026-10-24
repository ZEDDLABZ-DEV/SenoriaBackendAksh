# 04 — Admin Feature Inventory

Status values:

| Status | Meaning |
|---|---|
| **Implemented** | A reachable screen performs the action and a live `ApiClient` call exists for it. |
| **Partial** | The screen exists, but part of the action is local-only, lossy, or incomplete relative to the data the same screen displays. |
| **Local only** | The UI changes memory and does not call the API. |
| **Placeholder** | Visible control with no API and no real workflow. |
| **Inaccessible** | Code exists and no screen opens it. |

Only this repository’s admin app is classified. Absence here is not evidence the original web portal lacked the feature.

## Routes

Registered in `AppPages` (**CONFIRMED**):

| Route | Widget | Purpose |
|---|---|---|
| `/` | `SplashScreen` | Session gate |
| `/login` | `LoginScreen` | Sign in |
| `/dashboard` | `DashboardScreen` | Home |
| `/clients` | `ClientsScreen` | Client directory |
| `/client-detail` | `ClientDetailScreen` | Client profile. Argument: client id string. |
| `/create-client` | `CreateClientScreen` | Create client |
| `/appointments` | `AppointmentsScreen` | Schedule |
| `/appointment-detail` | `AppointmentDetailScreen` | Visit detail. Argument: appointment id. |
| `/create-appointment` | `AppointmentFormScreen` | Create visit |
| `/edit-appointment` | `AppointmentFormScreen` | Edit or delete visit. Argument: appointment id. |

`AppRoutes.editClient` (`/edit-client`) is **not** registered. **Inaccessible.**

## Screens and operations

### Splash — Implemented (local)

Waits 800 ms. Opens the dashboard when SharedPreferences `is_logged_in` is true. Does not call the API and does not check token expiry or role.

### Login — Implemented

Email and password form, show/hide password, submit to `POST /auth/login`, `ADMIN` role gate, token persistence, navigation to dashboard.

**Forgot password — Placeholder.** Snackbar only. No API.

### Dashboard — Partial

| Control | Status | Evidence |
|---|---|---|
| Greeting with admin full name | Implemented | Local user record |
| Logout | Implemented | Local session clear only. No server logout. |
| Total clients card | Implemented | `GET /dashboard/stats` `totalClients`, with fallback to the client list length |
| Today’s appointments card | Implemented | `todayAppointments` from stats. Taps through to the full appointment list, not a today-filtered query. |
| Client preview (4 rows) | Implemented | `GET /clients` page 1. Pull-to-refresh reloads clients and stats. |
| Add client / view clients | Implemented | Navigation |
| Stats `activeCarePlans`, `totalCaregivers`, `completedAppointmentsToday`, `pendingAppointmentsToday`, `clientsGrowth`, `appointmentsGrowth` | Parsed, not shown | Model only |
| `activeAppointments` getter | Unused by the dashboard UI | Counts the in-memory dummy/local appointment list, not the API list |

### Clients list — Partial

| Control | Status | Evidence |
|---|---|---|
| Search | Implemented | Debounced 400 ms `search` query on `GET /clients` |
| Care-type chips / filter | Local only | Filters the already loaded page. Care type is derived from the first service requirement’s category, or “General Care”. |
| Open detail | Implemented | |
| Add client | Implemented | |
| Pagination / load more | Implemented | Loads every page at `pageSize` 50 until the list is complete |
| Sort control | Missing | |

### Create client — Implemented

Form sections: identity (full name, date of birth, gender, phone, emergency name, relation, phone), primary condition, medical conditions, allergies, preferred language, communication notes, address (street, city, state, zip, country, gate code, navigation). Submit calls `POST /clients`.

Not on this form: email, apartment, hazards, service requirements, care plan, profile image. A hint widget tells the user later steps exist; those steps are the client detail sheets, not this submit.

### Client detail — Partial

Loaded with `GET /clients/{id}`. Pull-to-refresh refetches.

| Section | Read | Write | Status |
|---|---|---|---|
| Identity (name, age, gender, care type, phone, email, emergency name and phone) | Yes | No reachable writer | **Partial** (read-only). `EditClientSheet` would edit name, age, gender, care type, phone, email, and emergency fields in memory only, and nothing opens that sheet. |
| Diagnoses | Yes | `PUT /clients/{id}` shape A | **Implemented**, with the notes-tag round-trip described in the models doc |
| Languages | Yes | `PUT /clients/{id}` shape A | **Partial**. One preferred language and communication notes are saved. Additional languages and proficiency are not written. |
| Hazards | Yes, from the client payload and from `GET /clients/{id}/hazards` when the sheet opens | `POST`, `PUT`, and `DELETE` hazard | **Implemented**. Add, edit the description, and delete. Types are `environmental_risks` and `medical_risks`. No severity or precautions. |
| Service requirements | Yes | `updateServiceInfo` in memory | **Local only** |
| Care plan header | Yes (first plan) | `POST /care-plans` when the plan has no server id | **Partial**. A plan that already has an id is saved with `saveCarePlanDetails` in memory only. No PUT/PATCH care plan. |
| Care plan items (task, medication, diet, hygiene) | Yes, from nested arrays on the client payload | `POST` to the matching sub-resource on add | **Partial**. Add is remote. Edit, delete, and the completion checkbox call `updateCarePlanTask`, `removeCarePlanTask`, and `setCarePlanTaskCompleted` in memory only. |
| Appointments on the client | Yes, embedded array | Navigate to create appointment with the client id | **Partial**. No edit/delete from this list. Status mapping here does not treat `no_show` as cancelled. |
| Directions | Yes | `PUT /clients/{id}` shape B | **Implemented** for street, city, state, zip, country, gate code, navigation. Apartment is preserved, not edited. Entry instructions and parking are displayed if present in memory and are not part of the API mapping. |

Client detail does not delete a client. **Decided:** only the admin web portal deletes a client, by removing the row. A caregiver cannot.

### Appointments list — Partial

| Control | Status | Evidence |
|---|---|---|
| Search | Implemented | Debounced 400 ms, `GET /appointments?search=` |
| Status tabs | Local only | Scheduled / completed / cancelled filters on the fetched list. The API is not passed `status`. |
| Date range | Not for now | **Decided:** `dateFrom` and `dateTo` are not sent and are not supported. No date picker on the list. |
| Pagination | Implemented | Follows `meta.hasNextPage` with `pageSize` 100 |
| Open detail | Implemented | |
| New appointment | Implemented | |
| Pull-to-refresh | Implemented | |

### Appointment detail — Implemented (read) 

`GET /appointments/{id}`. Shows status (collapsed to three values), type, schedule, check-in, check-out, client and caregiver name/phone/email, location, gate code, navigation text, notes, and tasks (title, description, completed flag). Edit button opens the edit form after copying the detail into the local appointment model.

Tasks are display-only. `carePlanId`, raw `status` (distinct from `appointmentStatus`), `createdAt`, and `updatedAt` are parsed and not shown. Nested emergency contacts and care plans on the party objects are parsed; the party section renders name, phone, and email.

### Appointment create — Partial

`POST /appointments` with client, caregiver, date, start, end, visit type, instructions, and location fields.

After success, a dialog offers to add visit details. “Add details” opens the edit form. Hazards added there call the **client** hazard API. Service requirements and priority edited there stay on the local `Appointment` object (`updateAppointment`) and are not sent on the PUT that the edit screen uses for the appointment itself. Care plan is not part of the appointment save body.

The success path does not refetch `GET /appointments`, so the new visit can be missing from the list until the next fetch. **CONFIRMED** in `createAppointment`.

### Appointment edit and delete — Partial

| Action | Status |
|---|---|
| Change caregiver, schedule, type, instructions, notes, location, and the three statuses | **Implemented** via `PUT /appointments/{id}` |
| Change client | Not in the PUT body. The client dropdown is not the contract for update. |
| Delete | **Implemented** via `DELETE /appointments/{id}` after confirm |
| Notes | **Implemented.** Create and edit send the Notes field. Blank sends `""` and clears stored notes. |
| Priority | UI only. Not in the body. |
| Service requirements on the form | Local only |
| Hazards on the form | **Implemented** against the client hazard endpoints, not an appointment hazard resource |
| Safety instructions | Local only |
| Statuses other than scheduled/completed/cancelled | Collapsed on read and overwritten on save. **Partial.** |

`changeStatus` on the controller updates memory only and has **no caller**. **Inaccessible.**

### Caregiver directory — Partial

The assign dropdown loads every page of `GET /users/caregivers`, 100 at a time. The phone has no caregiver profile screen, no create, and no deactivate. **Decided:** the web portal creates caregivers and can turn an account off. A turned-off caregiver is omitted from this list.

### Visit types — Implemented (read)

Dropdown from `GET /appointments/types`. No admin UI to add or rename types.

### Dummy appointments — Local only

`AppointmentController.onInit` loads `DummyData.appointments()` into `appointments`. The list UI does not bind to that collection. It can still affect edit-mode lookup if a route is opened with an id that exists only in dummy data. The normal detail-to-edit path overwrites the matching id from the API detail first.

## API calls with no dedicated screen

| Call | How it is reached |
|---|---|
| `POST /auth/refresh` | Automatic. No screen. |
| `GET /dashboard/stats` extra fields | Response parsed; six of eight fields have no widget. |
| `GET /users/caregivers` | Only the appointment dropdown, not a directory screen. |

No called endpoint is completely unreachable. Refresh is infrastructure. Every other call is triggered from a screen or sheet listed above.

## Menu

There is no drawer of admin modules. Navigation is the dashboard cards, the appointments call-to-action, the clients list, and per-entity app bars. Modules that a full admin portal often has (users, roles, reports, settings, billing, audit log) do not appear in this app. That absence is **UNKNOWN** for the original portal, not a confirmed deletion.
