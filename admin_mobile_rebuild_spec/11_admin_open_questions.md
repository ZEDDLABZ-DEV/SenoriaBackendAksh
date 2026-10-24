# 11 — Open Questions

These items are not answered by the admin mobile source. Building a complete backend and a complete admin web portal requires answers from the original portal, a business owner, or captured traffic. Do not fill them by renaming fields.

## Blocking API conflicts

1. **PUT `/clients/{id}` semantics.** **Decided.** Merge. Update only the fields present in the body. Leave omitted fields and child lists unchanged. Shape A (no `email` or `status`) must not clear those. Shape B (no diagnoses, languages, or emergency contact) must not clear those child lists, service requirements, hazards, or care plans.
2. **PUT `/appointments/{id}` semantics.** **Decided.** Merge. Update only the fields present in the body. Leave omitted fields unchanged. The admin Notes field is present: a blank Notes field sends `""` and clears stored notes. The caregiver cancel body `{ "appointmentStatus": "cancelled" }` changes status only. It must not clear schedule, location, caregiver, notes, or `clientId`. `clientId` is omitted from the admin update, so an admin save must not clear the client.
3. **Login `role` field.** **Decided.** `POST /auth/login` accepts `{ "email", "password" }`. A `role` field in the body is ignored. The account stores the role. There is exactly one user with role `ADMIN`. Every other user is `CAREGIVER`. The response `user.role` is that stored value. The admin app continues only for `ADMIN`. The caregiver app continues only for `CAREGIVER`. The server enforces the same split: a caregiver token cannot call admin routes.
4. **Error JSON.** **Decided.** Do not change either app’s parser. Every error body includes both shapes those parsers already read, with the same text in both message fields: `error.message`, `error.code`, and `error.fields` for the admin app, and top-level `message`, `code`, and `errors` (a map of string arrays) for the caregiver app.
5. **Appointment list field names.** **Decided.** Keep the names each app already reads. `GET /appointments` rows use `status` and `type`. Appointment detail and the caregiver model use `appointmentStatus` and `appointmentType`. Do not use one field name for every appointment endpoint.
6. **Two status fields on appointment detail.** **Decided.** Detail `status` is unused. The visit status is `appointmentStatus`. The server may omit detail `status` or send `""`. The admin app does not display it and does not write it. List `status` is a different field: it is the short name for the visit status on `GET /appointments`.

## Auth still unknown

7. **JWT access token.** **Decided.** HS256. The apps treat the token as an opaque string. The only claim is `sub` (user id). There is no `role` claim. The server loads the account from `sub` and uses the stored role. Issuer is this API. The apps do not check issuer or audience. Access-token lifetime is 1 hour. Login and refresh return `expiresIn: 3600`.
8. **Refresh token.** **Decided.** The refresh token lasts 7 days from login and is not rotated. Refresh returns a new access token and `expiresIn: 3600`, and omits `refreshToken` so the app keeps the original one. The admin app refreshes that access token at 55 minutes. That keeps the admin signed in until the 7-day refresh token ends. A refresh after those 7 days fails and the app returns to login. `expiresIn: 0` signs the admin out instead of refreshing.
9. **`permissions`.** **Decided.** Not used. Login returns `permissions: []`. The server does not enforce permission strings. Access is the stored account role: one `ADMIN`, every other user `CAREGIVER`. The login response still includes `user.role`, because the admin app rejects a session unless that value is `ADMIN`.
10. **Caregiver token on admin routes.** **Decided.** A caregiver token cannot call `GET /clients`, `GET /users/caregivers`, or `DELETE /appointments/{id}`. Those routes require the `ADMIN` account. The caregiver app uses its own caregiver-scoped routes.
11. **Password policy, lockout, and MFA.** **Decided.** Password must be at least 6 characters. No required symbol or number. No account lockout. No multi-factor authentication. The admin UI still only checks non-empty, so a shorter password fails on the server. The caregiver UI already requires 6 characters.
12. **Server logout and password reset.** **Decided.** The server provides `POST /auth/logout`, `POST /auth/forgot-password`, and `POST /auth/reset-password`. Logout revokes the current refresh token. A reset password must be at least 6 characters. Neither phone calls these routes. The admin “Forgot password?” control stays “Coming soon,” and both apps still sign out by clearing local storage only. Request bodies are not fixed by either app.
13. **`expiresIn: 0`.** **Decided.** Not a valid success value. Login and refresh that return `expiresIn` of `0` sign the admin out. They do not start or keep a session. When `expiresIn` is `3600`, the app refreshes the access token at 55 minutes (5 minutes before the hour ends).

## Domain data still unknown

14. **Client `status`.** **Decided.** Exactly two values: `active` and `inactive`. Create does not send `status`, so a new client defaults to `active`. A directions save may send the cached value. Any other string is rejected. The phone does not show or edit this field.
15. **Caregiver `role` on `GET /users/caregivers`.** **Decided.** Both. The account auth role is `CAREGIVER`. The list field `role` is the position (subrole) the phone already shows beside the name. The starting catalog is: Health Care Aide (HCA), Care Aide / Personal Support Worker (PSW), Community Support Worker, Companion Caregiver, Home Support Worker, Respite Care Worker, Registered Nurse (RN), Licensed Practical Nurse (LPN), Sales Closer, Client Acquisition Specialist, Other. The admin web portal can add positions. The admin mobile app only displays the returned `role` string and cannot create positions.
16. **Visit-type catalog.** **Decided for now.** `GET /appointments/types` returns `regular_visit` / Regular Visit and `doctor_visit` / Doctor Visit. The admin app shows those labels and stores the `value`. The caregiver app still treats `doctor_visit` as a doctor visit. Doctor and clinic fields stay unread by the admin app. The catalog can be extended later.
17. **Service requirements.** **Decided.** The admin web portal creates and edits them. The phone shows the rows from `GET /clients/{id}` and does not save edits. `PUT /clients/{id}` must not delete them.
18. **Hazards.** **Decided.** Types are only `environmental_risks` and `medical_risks`. A hazard has no `severity` and no `precautions`. The body is `type` and `description`. Both the admin web portal and the admin mobile app can add and edit hazards. The phone edits by tapping a hazard and sending `PUT /clients/{clientId}/hazards/{hazardId}`. Delete stays on the phone.
19. **Diagnosis `notes` tags.** **Decided.** Keep them. The server stores diagnosis rows with `notes` of exactly `Primary condition`, `Medical condition`, or `Allergy`. A diagnosis save rebuilds those three lists from those tags.
20. **One emergency contact and one care plan.** **Decided.** Each client has one emergency contact and one care plan. The phone already edits that one contact and shows that one plan. The server does not store a second contact or a second care plan. The JSON fields stay arrays so the current app can keep reading them, and each array has at most one item.
21. **Visit tasks.** **Decided.** They are the client’s one care plan’s tasks. The appointment does not store its own task list. `GET /appointments/{id}` may still include `tasks` so the phone can show them, and those rows are the care-plan tasks. Completing a task uses the care-plan completion call. The admin phone only displays them.
22. **“Today”.** **Decided.** Use the timezone of the device making the request. The admin dashboard sends `timeZoneOffset` (for example `+05:30`) on `GET /dashboard/stats`. `todayAppointments` and the other “today” counts use that offset’s calendar day. Caregiver `completedToday` uses the caregiver device’s offset the same way. The server does not pick UTC or a fixed office timezone.
23. **Growth numbers.** **Decided.** Not used for now. The server may omit `clientsGrowth` and `appointmentsGrowth`, or send `0`. The admin app already treats a missing value as `0` and does not show either number. The web portal does not show them until a later decision.
24. **Client delete.** **Decided.** Remove the row. A deleted client is gone from the database, not hidden. `deletedAt` is not used. The phone still parses `deletedAt` if a response includes it, and does not show it. The phone has no delete-client call. The web portal deletes by removing the row. Lists do not return that client because the row no longer exists.
25. **Search.** **Decided.** Names only. Ignore capital letters and match part of the word. `GET /clients` `search` matches `firstName` or `lastName`. `GET /appointments` `search` matches the client’s first or last name. Care type stays a filter on the phone and is not a server search field. **Decided for paging:** the phone loads every page of clients, caregivers, and appointments. Clients use `pageSize` 50, caregivers and appointments use `pageSize` 100, and each list continues until there is no next page.
26. **Appointment list filters.** **Decided.** Not for now. `GET /appointments` accepts `page`, `pageSize`, and `search`. It does not accept `status`, `dateFrom`, or `dateTo`. The phone keeps the Scheduled, Completed, and Cancelled tabs on the device after the list arrives.
27. **Caregiver overlap.** **Decided.** A caregiver may have more than one visit. On the same day, the times must not overlap. A visit from 10:00 to 11:00 allows the next visit for that caregiver to start at 11:00. A start before 11:00 is rejected. The phone does not check this. The server rejects create and update with the existing error shape, and the phone shows that message.
28. **Organization.** **Decided.** One organization. There is no branch, facility, or organization id. Every client, caregiver, and visit belongs to the same Senoria. The phone does not send an organization id, and the server does not add one.
29. **Photos.** **Decided.** Not for now. `profileImage` and `avatar` stay empty. The server may omit them or send `null`. There is no upload call. The phone keeps showing initials.
30. **Map coordinates.** **Decided.** Not for now. Client address `latitude` and `longitude` stay empty. The server may omit them or send `null`. The admin phone does not show or save them. `POST /care-plans/{id}/check-in` has no location body until a later decision.

## Portal scope still unknown

31. **Caregiver accounts.** **Decided.** The admin web portal creates a caregiver login and can turn that account off. The portal collects name, email, password, and a position. The auth role of that account is `CAREGIVER`. There is still exactly one `ADMIN` account, and there is no invite-admin screen. A turned-off caregiver cannot sign in and is left out of `GET /users/caregivers`, so the phone cannot assign them to a new visit. Visits already saved keep their caregiver. Neither phone calls the create or deactivate routes. The phone only lists caregivers.
32. **Office tools.** **Decided.** None for now. The web portal does not include reports, billing, payroll, messaging, documents, or an audit log. It covers clients, visits, caregivers, and care plans.
33. **Client edits on the web portal.** **Decided.** The admin web portal can edit name, date of birth, gender, phone, email, apartment, diagnosis `icdCode`, and the items on the one care plan. The phone stays as it is: it does not gain editors for those fields. A phone save that omits them must not clear them. Service requirements stay editable on the web portal only.
34. **Repeating visits and availability.** **Decided.** None for now. Each visit is a single date and time. No repeating visits, no time-off dates, and no weekly availability calendar. The same-day overlap rule still applies. The phone is unchanged.
35. **Messages.** **Decided.** None for now. No push notifications and no email templates. Password reset stays on the server, and neither phone calls it.
36. **Who can delete.** **Decided.** Only the admin. The admin phone can delete a visit with `DELETE /appointments/{id}`. The web portal can delete a visit or a client. A caregiver cannot delete either. Deleting a client still removes the row.

## Response shapes that need a sample

A single captured 2xx body would remove the parser ambiguity for:

- `POST /appointments` (only `id` is required by the app)
- `PUT /appointments/{id}` (body ignored)
- `DELETE /appointments/{id}` (body ignored)
- `DELETE` hazard (body ignored)
- `POST` care-plan medication, hygiene, and task (success even when `data` is missing)
- `GET /clients` (several envelopes accepted)
- `GET /users/caregivers` — the phone now requests the next page until the list is complete
- `GET /appointments/types` returns `regular_visit` and `doctor_visit` for now

## Product decisions before implementation

These are choices, not discoveries. They should be made explicitly so the mobile apps keep working:

- **Decided for `PUT /clients/{id}` and `PUT /appointments/{id}`.** Merge: update only fields present in the body; leave omitted fields and child lists unchanged. Both admin bodies, and the caregiver cancel body `{ "appointmentStatus": "cancelled" }`, are valid. A blank appointment Notes field is present as `""` and clears stored notes.
- **Decided for appointment list names.** `GET /appointments` keeps `status` and `type`. Detail and caregiver payloads keep `appointmentStatus` and `appointmentType`.
- **Decided for diagnosis tags.** Return diagnosis rows with `notes` of `Primary condition`, `Medical condition`, or `Allergy`.
- **Decided for login.** Body is `email` and `password` only. Ignore `role` if a client sends it. Exactly one `ADMIN` user. Every other user is `CAREGIVER`. Each app and the server enforce that role. A caregiver token cannot call `GET /clients`, `GET /users/caregivers`, or `DELETE /appointments/{id}`.
- **Decided for errors.** Keep both existing parsers. Each error body includes `error.message`, `error.code`, and `error.fields`, and the same text at top-level `message` and `code`, plus `errors` as a map of string arrays.
- **Decided for sessions.** Access token lasts 1 hour (`expiresIn: 3600`), signed HS256, with `sub` only. No `role` claim. The app refreshes it at 55 minutes. `expiresIn: 0` signs the admin out. Refresh token lasts 7 days from login and is not rotated.
- **Decided for `permissions`.** Always `[]`. The server does not enforce permission strings. `user.role` stays on the login response.
- **Decided for passwords.** At least 6 characters. No symbol or number rule. No lockout. No multi-factor authentication.
- **Decided for logout and password reset.** The server has `POST /auth/logout`, `POST /auth/forgot-password`, and `POST /auth/reset-password`. Logout revokes the refresh token. Neither phone calls these routes yet.
- **Decided for paging.** The server returns later pages. The phone loads every client and every caregiver, the same way it already loads every visit. Page size stays 50 for clients and 100 for caregivers.
- **Decided for “today”.** The device timezone. The admin dashboard sends `timeZoneOffset` such as `+05:30`. Dashboard “today” counts and caregiver `completedToday` use that device’s calendar day.
- **Decided for growth.** `clientsGrowth` and `appointmentsGrowth` are unused for now. Omit them or send `0`. Neither the phone nor the web portal shows them.
- **Decided for client delete.** Hard delete. The client row is removed. `deletedAt` is unused. The phone does not call delete.
- **Decided for search.** Names only, case-insensitive, partial match. Clients match first or last name. Appointments match the client’s name. Care type stays on the phone. The phone loads every page of search results.
- **Decided for appointment list filters.** Not for now. `GET /appointments` accepts `page`, `pageSize`, and `search` only. No `status`, `dateFrom`, or `dateTo`.
- **Decided for caregiver overlap.** More than one visit is allowed. On the same day, the next visit may start at the previous visit’s end time and must not start earlier. The phone does not check. The server rejects the overlap.
- **Decided for organization.** One Senoria. No branch, facility, or organization id.
- **Decided for photos.** Not for now. `profileImage` and `avatar` are omitted or `null`. No upload. The phone shows initials.
- **Decided for map coordinates.** Not for now. Address `latitude` and `longitude` are omitted or `null`. Check-in has no location body.
- **Decided for caregiver accounts.** The web portal creates a caregiver (name, email, password, position) and can turn that account off. Still one `ADMIN`. A turned-off caregiver cannot sign in and is omitted from `GET /users/caregivers`. The phone only lists caregivers.
- **Decided for office tools.** None for now. No reports, billing, payroll, messaging, documents, or audit log.
- **Decided for portal client edits.** The web portal can edit name, date of birth, gender, phone, email, apartment, diagnosis `icdCode`, and care-plan items. The phone does not. A phone save that omits those values must not clear them.
- **Decided for repeating visits and availability.** None for now. Each visit is one date and time. No time off and no availability calendar. The overlap rule stays.
- **Decided for messages.** None for now. No push notifications and no email templates.
- **Decided for delete.** Only the admin. The admin phone can delete a visit. The web portal can delete a visit or a client. A caregiver cannot delete either.

## What this audit already fixed as facts

- 22 live admin endpoints, documented in `01`.
- JSON names and nullability in `02`.
- Admin role gate `ADMIN`, bearer tokens, and refresh behavior in `03`.
- Partial features (service requirements, care-plan edits, identity edit, status collapse) in `04` and `05`. Appointment notes are a real create/edit field.
- No secrets were copied from a credential store. The only auth material in source is the public API host and empty placeholder copy in the login hint string `rep@gmail.com`, which is UI hint text, not an account.
