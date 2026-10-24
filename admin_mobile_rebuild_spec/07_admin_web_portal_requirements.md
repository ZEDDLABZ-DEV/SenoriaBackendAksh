# 07 — Admin Web Portal Requirements

The admin mobile app is a partial view of the original admin web portal. This file splits what the mobile source proves from what a portal rebuild still has to discover.

The sibling caregiver app adds domain facts about the same API. Those facts are referenced, not treated as admin-portal features. Its own `BACKEND_API_SPEC.md` is an older draft and is not used here.

## A. Functionality established by the admin mobile app

A portal that replaces day-to-day use of this app needs the following. Each item is **CONFIRMED** as a mobile behavior. The portal may present it differently, but the API contract in `01` and `02` should stay compatible with the mobile app.

### Access

- Email and password sign-in. The body does not include `role`. Exactly one account has role `ADMIN`, and that is the account this portal accepts. Every other account is `CAREGIVER` and is rejected here.
- Access-token and refresh-token session, with expiry.
- Sign-out that clears the local session. The mobile app does not revoke the server token. A portal may revoke tokens; that would be an addition, and the mobile app would not call it.
- Unauthorized and forbidden responses the mobile client already understands (`401`, `403`).

### Home

- Counts for total clients and today’s appointments.
- A short list of clients with navigation into the directory.
- The stats payload also carries active care plans, total caregivers, and completed and pending appointments today. The phone does not render those. **Decided:** `clientsGrowth` and `appointmentsGrowth` are unused for now. Omit them or send `0`. The web portal does not show growth until a later decision.

### Clients

- Searchable directory of clients (server `search`). **Decided:** `search` matches first or last name only. Care type stays a phone filter. The phone loads every page, 50 at a time.
- Create a client with name, date of birth, gender, phone, emergency contact (name, relationship, phone), primary condition, medical conditions, allergies, one language, communication note, and address (street, city, state, zip, country, empty apartment, gate code, navigation instructions).
- Open a client and see email, age, care type, diagnoses (including ICD and severity when notes are empty), languages, hazards, service requirements, the one care plan and its four item types, embedded appointments, and directions.
- Update diagnoses, language/communication note, and directions through `PUT /clients/{id}`.
- Add, edit, and delete hazards (`environmental_risks`, `medical_risks`). A hazard is `type` and `description` only. There is no severity and no precautions.

### Care plans

- Create one care plan for a client: name, description, optional start and end, goals, status `active` | `inactive` | `completed`.
- Add tasks, medications (including schedule codes OD, BD, TDS, QID, PRN, HS), diet rows, and hygiene rows.
- Read items back on the client payload under `tasks`, `medications`, `dietInstructions`, and `hygieneInstructions`.

### Schedule

- Search and page through all appointments, not only one caregiver’s.
- See client name, caregiver name, date, time range, type, and a collapsed status.
- Create a visit: client, caregiver, date, start, end, type from `GET /appointments/types`, instructions, and a location snapshot.
- Open a visit: description, instructions, notes, check-in, check-out, both parties’ phone and email, location, gate code, navigation text, and tasks.
- Update caregiver, schedule, type, instructions, location, and status `scheduled` | `completed` | `cancelled`.
- Delete a visit. **Decided:** only the admin. The admin phone already calls `DELETE /appointments/{id}`. A caregiver cannot.

### People

- Read a caregiver list (`id`, name, position in `role`, phone, email, avatar) to assign a visit. Page size used by the phone is 100. The account auth role is `CAREGIVER`. The phone does not edit positions.

### Catalog

- Read visit types as `{ value, label }`.

## A.1 Mobile behavior a portal should not copy blindly

These are real mobile behaviors. A portal that shares the API must stay compatible, but product-wise they are gaps:

- PUT client uses two different bodies (full flat profile vs directions-only with email and status).
- Appointment `notes` is a real field on create and edit. A blank Notes field sends `""` and clears stored notes.
- Finer appointment statuses collapse to three values and can be overwritten.
- Service-requirement edits, care-plan edits after create, item completion, and item delete are not saved.
- Client identity (name, phone, email, emergency contact) has no reachable editor on the phone. **Decided:** the web portal can edit name, date of birth, gender, phone, email, and apartment. The phone does not. A phone save that omits those values must not clear them.
- Hazards edited from a visit are stored on the client.
- No file upload, no reports export, no audit screen, no user admin screen.

## B. Additional portal functionality that this mobile app cannot establish

Do not treat these as out of scope for the original portal. They are **UNKNOWN** from the admin app. Investigate the original portal, business owners, or captured traffic before dropping them.

### Identity and administration

- A second admin user. **Decided:** there is exactly one `ADMIN` account. No invite-admin screen.
- Caregiver accounts. **Decided:** the web portal creates a caregiver with name, email, password, and a position, and can turn that account off. The auth role is `CAREGIVER`. A turned-off caregiver cannot sign in and is omitted from `GET /users/caregivers`. Visits already saved keep their caregiver. Neither phone calls these routes.
- Password reset. **Decided:** the server has `POST /auth/forgot-password` and `POST /auth/reset-password`. The phone still shows a placeholder and does not call them. A new password must be at least 6 characters.
- Server-side logout. **Decided:** `POST /auth/logout` revokes the refresh token. The phone still only clears local storage.
- A permission catalog. **Decided:** `permissions` is always `[]`. The server does not enforce permission strings.
- Caregiver positions. **Decided:** the admin web portal adds them. Starting values are Health Care Aide (HCA), Care Aide / Personal Support Worker (PSW), Community Support Worker, Companion Caregiver, Home Support Worker, Respite Care Worker, Registered Nurse (RN), Licensed Practical Nurse (LPN), Sales Closer, Client Acquisition Specialist, and Other. `GET /users/caregivers` returns the chosen position in `role`. The mobile app does not manage this catalog.
- Organization, branch, or facility structure. **Decided:** one organization. No branch and no organization id.

### Client records the phone does not write

- Email, apartment, and diagnosis `icdCode`. **Decided:** the web portal can edit them. The phone does not. A phone save that omits them must not clear them. Profile image and latitude/longitude stay unused for now: omit them or send `null`. No upload. Diagnosed date, diagnosis severity, language proficiency, and additional languages are not part of this edit decision.
- Client status. **Decided:** `active` or `inactive`. The phone only echoes `status` and defaults a missing value to `active` on a directions save. Create omits it.
- Deleting a client. **Decided:** only the admin, and only from the web portal. The portal removes the row. The client is gone from the database. `deletedAt` is unused. The phone has no delete-client call. A caregiver cannot delete a client. Merging clients is not part of this decision.
- One emergency contact per client. **Decided.** The phone edits that contact. The server does not store a second one.
- One care plan per client. **Decided.** The JSON field remains an array with at most one item.
- Service requirements. **Decided:** the admin web portal creates and edits them. The phone shows them and does not save edits.
- Hazard fields are `type` and `description` only. **Decided:** no severity and no precautions. Both the web portal and the phone can add and edit.
- Entry instructions and parking. They exist on the phone’s local model and are not in the address JSON.

### Scheduling the phone does not cover

- **Decided:** `status`, `dateFrom`, and `dateTo` are not supported on `GET /appointments`. The phone filters status and date after the list arrives.
- Check-in and check-out capture. The phone displays the timestamps. The caregiver app declares `POST /care-plans/{id}/check-in`. **Decided:** that call has no location body for now.
- Daily completion. The caregiver app declares `POST /appointments/{id}/daily-completion/toggle` with a `date`.
- Cancellation reason. The caregiver model parses `cancellationReason`. The admin update sends only `appointmentStatus: cancelled`.
- Visit tasks are the client’s care-plan tasks. **Decided.** The phone only displays them. Completing one uses `POST /care-plans/{id}/completions/toggle`.
- Visit types administration (add, rename, retire).
- Repeating visits, time off, and caregiver availability. **Decided:** none for now. Each visit is one date and time. **Decided for overlap:** the server rejects a visit that starts before another visit for the same caregiver on the same day has ended. Starting at that end time is allowed. The phone does not check.
- Doctor-visit fields the caregiver client parses on embedded appointments: `doctorName`, `doctorSpecialty`, `doctorPhone`, `clinicName`, and type `doctor_visit`. The admin appointment detail model does not read them.

### Reporting and operations

- The six dashboard integers that are parsed and not shown, once their definitions are known.
- Any report, invoice, payroll, document, message, or audit-log module. **Decided:** none for now. The portal covers clients, visits, caregivers, and care plans.
- Exports and print views.
- Notification and email templates. **Decided:** none for now. No push notifications.

### Caregiver mobile workflows that imply portal or backend support

From the sibling caregiver source (calls commented out, models live):

| Capability | Endpoint the caregiver client declares |
|---|---|
| My appointments | `GET /appointments/caregiver/{caregiverId}` |
| My clients | `GET /clients/caregiver/{caregiverId}` |
| Appointment detail shared with admin | `GET /appointments/{id}` |
| Cancel from the field | `PUT /appointments/{id}` with `{ "appointmentStatus": "cancelled" }` |
| Toggle today’s visit completion | `POST /appointments/{id}/daily-completion/toggle` |
| Toggle a care-plan item for a day | `POST /care-plans/{carePlanId}/completions/toggle` |
| Check in to a care plan, with location | `POST /care-plans/{carePlanId}/check-in` |

A portal does not have to duplicate the caregiver UI. The backend behind the portal must not break these contracts if the caregiver app is pointed at the same server. Details and conflicts are in `08_shared_api_contracts.md`.

## Suggested portal information architecture

This is a reading aid, not a confirmed sitemap of the original portal.

1. Sign in
2. Home (the two counts the phone shows, plus the unused stats once defined)
3. Clients: directory, create, detail, section editors that actually persist
4. Client care plan and hazards
5. Appointments: directory, create, detail, edit, delete
6. Caregiver picker (read-only until user-admin requirements are found)
7. Explicit backlog for section B

Build section A against the contracts in this folder first. Hold section B until the open questions in `11` are answered by someone who knows the original portal or by captured API traffic.
