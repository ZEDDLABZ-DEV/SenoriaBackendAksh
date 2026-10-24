# 06 — Admin Database Requirements

This is **not** the original database schema. The original server source is not in this repository. Every entity below is proposed because the admin app sends or parses the corresponding JSON. Labels:

- **CONFIRMED** — a request or response field exists in this app.
- **INFERRED** — a table, key, or rule is the smallest structure that explains those fields.
- **UNKNOWN** — do not invent a column.

IDs are opaque strings. The app does not validate UUID format.

## Proposed entities

### User

**CONFIRMED** fields from login `user` and from caregiver list items: `id`, `email`, `firstName`, `lastName`, `role`, `avatar`, `phone` (caregiver list only), `permissions` (login user only, **decided** always `[]`).

**Decided.** Admins and caregivers share one user table. `user.role` is the auth role: one `ADMIN`, every other account `CAREGIVER`. `GET /users/caregivers` `role` is a separate position. Do not store the auth role in that list field, or the phone dropdown will show `CAREGIVER` instead of the position.

**INFERRED.** Password hashes exist because login accepts a password. The app never reads a password field back.

**UNKNOWN.** Permission storage (join table vs array column), refresh-token table, password reset tokens.

### Client

**CONFIRMED** scalar fields: `id`, `firstName`, `lastName`, `dateOfBirth`, `gender`, `phone`, `email`, `profileImage`, `notes`, `status`, `createdAt`, `updatedAt`, `createdById`, `updatedById`, `deletedAt`.

**INFERRED** relationships:

- `createdById` / `updatedById` reference users.
- **Decided:** deleting a client removes the row. `deletedAt` is unused. The phone parses it and does not show it. There is no soft-delete filter, because a deleted client is no longer stored. The phone has no delete-client call. The web portal deletes by removing the row.

**CONFIRMED** child collections parsed on the client: address, emergency contacts, diagnoses, languages, hazards, service requirements, care plans, appointments.

### Address

**CONFIRMED** as a nested object with its own `id`: `street`, `apartment`, `city`, `state`, `zipCode`, `country`, `gateAccessCode`, `navigationInstructions`, `latitude`, `longitude`. **Decided:** `latitude` and `longitude` are unused for now. Omit them or send `null`. The admin phone does not write them.

**INFERRED** one address per client (the payload is a single object, not an array). Appointment location is **not** this object. Appointments store flat `locationStreet`, `locationCity`, `locationState`, `locationZipCode`, `locationGateCode`, `locationNavigation` on the appointment itself. **CONFIRMED** by the appointment body. **INFERRED** those columns are denormalized and can diverge from the client address.

Read compatibility: `zipCode` may arrive as `postalCode`. **CONFIRMED** fallback. Writes use `zipCode`.

### Emergency contact

**CONFIRMED:** `id`, `name`, `relationship`, `phone`, `email`, `isPrimary`, `clientId`, `createdAt`, `updatedAt`.

**Decided.** One emergency contact per client. The admin UI edits that contact by sending three flat fields on PUT shape A. Shape B omits those fields, so the contact stays. Shape A updates that one contact. The response array `emergencyContacts` has at most one item.

### Diagnosis

**CONFIRMED:** `id`, `name`, `icdCode`, `diagnosedDate`, `severity`, `notes`, `isActive`, `clientId`, timestamps.

**Decided.** Many diagnoses per client. The create/update API does not accept the diagnosis object. It accepts `primaryCondition`, `medicalConditions[]`, and `allergies[]`, and the server persists them as diagnosis rows whose `notes` are exactly `Primary condition`, `Medical condition`, or `Allergy`.

**Decided.** The web portal can edit `icdCode`. The phone never sends it. A phone diagnosis save must not clear a stored `icdCode`. `diagnosedDate` and `severity` are not part of that decision.

### Language

**CONFIRMED:** `id`, `name`, `proficiency`, `isPrimary`, `clientId`, timestamps.

**INFERRED** many per client. Admin writes a single `language` string. **Decided:** other language rows are not deleted, because the languages child list is omitted from both PUT bodies. **UNKNOWN** whether the server marks the written row `isPrimary`.

### Hazard

**CONFIRMED:** `id`, `type`, `description`, `isActive`, `clientId`. **Decided:** no `severity` and no `precautions`.

**Decided** write rules: `type` is only `environmental_risks` or `medical_risks`. Many hazards per client, not per appointment. Create and update send `type` and `description`. The admin web portal and the admin mobile app can both add and edit. The phone uses `POST` to add and `PUT /clients/{clientId}/hazards/{hazardId}` to edit.

### Service requirement

**CONFIRMED** read fields: `id`, `category`, `name`, `description`, `frequency`, `specialInstructions`, `isActive`, `clientId`.

**INFERRED** many per client. **Decided:** the admin web portal creates and edits rows. The phone reads them on `GET /clients/{id}` and does not save edits. `PUT /clients/{id}` must not delete them.

`category` values seen in code: `medical` and anything else treated as non-medical. `frequency` values the reader understands: `daily`, `weekly`, `biweekly`, `bi-weekly`, `monthly`, `asneeded`, `as needed`, `as-needed`.

Priority is **not** a confirmed column.

### Care plan

**CONFIRMED:** `id`, `clientId` (on create), `name`, `description`, `startDate`, `endDate`, `goals` (string list), `notes`, `status`.

**Decided.** One care plan per client. The JSON field stays an array, `carePlans`, with at most one item, because the phone reads an array and uses the first item.

**CONFIRMED** status values written at create: `active`, `inactive`, `completed`.

### Care plan items (four collections)

**CONFIRMED** as separate arrays, not one polymorphic task table, because the JSON keys and POST URLs differ:

| Collection JSON key | POST path | Columns this app writes | Extra columns this app reads |
|---|---|---|---|
| `tasks` | `/care-plans/{id}/tasks` | `name`, `frequency`, `description` | `id`, `carePlanId` |
| `medications` | `/care-plans/{id}/medications` | `medicationName`, `dosage`, `schedule`, `description` | `id`, `carePlanId` |
| `dietInstructions` | `/care-plans/{id}/diet` | `meal`, `restrictions`, `description` | `id`, `carePlanId` |
| `hygieneInstructions` | `/care-plans/{id}/hygiene` | `activity`, `frequency`, `description` | `id`, `carePlanId` |

The caregiver app also reads `completedToday` on these items. The admin app does not. See shared contracts. **INFERRED** a completion record exists even though this admin app cannot persist completion.

### Appointment

**CONFIRMED** fields from detail, create, and update:

`id`, `description`, `scheduledDate`, `startTime`, `endTime`, `duration`, `appointmentType`, `appointmentStatus`, `instructions`, `notes`, `checkInTime`, `checkOutTime`, `status` (detail field, **decided unused**; omit or send `""`), `locationStreet`, `locationCity`, `locationState`, `locationZipCode`, `locationGateCode`, `locationNavigation`, `clientId`, `caregiverId`, `carePlanId`, `createdAt`, `updatedAt`.

List projection **Decided** and different from detail: `id`, `scheduledDate`, `startTime`, `endTime`, `clientName`, `caregiverName`, `status`, `type`. Detail keeps `appointmentStatus` and `appointmentType`.

**INFERRED** `clientName` and `caregiverName` are joins, not stored duplicates — unless the server denormalizes them. **UNKNOWN** which.

**INFERRED** `caregiverId` references a user. `clientId` references a client. `carePlanId` is nullable.

**Decided.** `PUT /appointments/{id}` is a merge. The admin update omits `clientId`, so the client association stays. A body that includes `clientId` would update it. Do not require `clientId` on PUT.

Nested client appointment objects also include `title`. Detail does not require `title`. **UNKNOWN** whether `title` is stored.

Caregiver app reads additional appointment fields (`endDate`, `cancellationReason`, `completedToday`, `activeToday`, `dailyVisitStatus`). They are not in the admin detail model. Treat them as caregiver-app requirements, not as admin-confirmed columns, until a shared decision is made. See `08`.

### Appointment task

**Decided.** These are the client’s one care plan’s tasks, not a separate appointment checklist. The admin app only displays them. `tasks[]` on the appointment detail uses `id`, `title` or `name`, `description`, and `isCompleted` or `completed`. Completing a task is the care-plan completion call.

### Appointment type catalog

**CONFIRMED** `{ value, label }` from `GET /appointments/types`.

**Decided for now.** The catalog is `regular_visit` (Regular Visit) and `doctor_visit` (Doctor Visit). The caregiver app special-cases `doctor_visit`. The admin app does not hardcode either value. It shows whatever this endpoint returns.

### Dashboard stats

Not a table. **INFERRED** aggregates:

- count of clients → `totalClients`
- count of appointments for the current calendar day → `todayAppointments`
- plus six integers the model parses and the screen ignores

“Today” is **decided** as the calendar day of the requesting device. The admin app sends `timeZoneOffset` on `GET /dashboard/stats`. Caregiver `completedToday` uses the caregiver device’s offset.

## Relationship summary

```
User (admin or caregiver)
  └── creates/updates Client (createdById, updatedById)     [INFERRED]

Client
  ├── Address                         0..1   [INFERRED cardinality]
  ├── EmergencyContact                0..n
  ├── Diagnosis                       0..n
  ├── Language                        0..n
  ├── Hazard                          0..n
  ├── ServiceRequirement              0..n
  ├── CarePlan                        0..n   (UI reads first)
  │     ├── CareTask
  │     ├── CareMedication
  │     ├── CareDietInstruction
  │     └── CareHygieneInstruction
  └── Appointment                     0..n
        ├── caregiver → User
        ├── carePlan → CarePlan       optional
        └── AppointmentTask           0..n   [ownership UNKNOWN]
```

## Constraints the app effectively requires

| Constraint | Level |
|---|---|
| Login user includes `id`, `email`, `accessToken`, `refreshToken` | CONFIRMED parse |
| Admin role string compares equal to `ADMIN` case-insensitively | CONFIRMED |
| Client id stable across create response and later GET | CONFIRMED usage |
| Care plan create returns an id before item posts | CONFIRMED |
| Hazard create id needed for delete | CONFIRMED |
| Appointment end time after start on the same day, enforced only in the client | CONFIRMED client rule. Server rule UNKNOWN. |
| Same caregiver, same day: the next visit may start at the previous end time and must not start earlier | **Decided.** Server rejects an earlier start. The phone does not check. |
| Gender stored so that `male`, `female`, `other` round-trip; other values are rewritten to `female` on the next profile PUT | CONFIRMED |
| Diagnosis classification strings are exact | **Decided.** `Primary condition`, `Medical condition`, `Allergy`. |
| List appointments support `page`, `pageSize`, `search`, and `meta.hasNextPage` | CONFIRMED |
| List clients support `page`, `pageSize`, `search` | **Decided.** The phone reads `total`, `totalPages`, and `hasNextPage`, and requests the next page until every client is loaded. |

## Unresolved schema questions

These are repeated in `11_admin_open_questions.md` because they block a faithful database:

- Whether `deletedAt` is honored by list endpoints. **Decided:** no. A deleted client row is removed. Lists do not filter on `deletedAt`.
- Whether `completedToday` is stored on care-plan items. **Decided:** it is the completion for the caregiver device’s calendar day.
- Original indexes, unique keys (email, phone), and cascade deletes
- Multi-tenant or organization id. **Decided:** one organization. No organization id is stored.
