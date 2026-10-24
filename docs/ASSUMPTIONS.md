# Assumptions and unimplemented endpoints

The caregiver behavior follows `backend_rebuild_spec`. These are the extra implementation choices, and the endpoints that were deliberately not built.

## Assumptions

1. **Client profile appointments** are limited to appointments whose `caregiverId` is the token subject. A caregiver does not receive another caregiver's visits inside a shared client's profile.
2. **Daily completion rejects a date after the request timezone's today**, even when that date is still inside `scheduledDate` through `endDate`. The caregiver dialog is for today or an earlier day.
3. **Daily completion does not require a stored check-in.** The specification rejects an incomplete checklist, a date outside the appointment range, and a cancelled visit. Those are enforced. A plan with zero items can be completed without a check-in.
4. **Checklist toggle requires a check-in** for that care plan, caregiver, and date. Toggle stays available after the day is marked complete, so a later tap still flips `completed`.
5. **Reusing a revoked refresh token revokes the rest of that login family.** A concurrent refresh that loses the race returns 401 and does not revoke the winner's new token.
6. **`refresh_tokens.family_id`** is an extra column used for that revocation. It is not part of the JSON contract.
7. **Inactive appointment records** (`status: "inactive"`) stay in the list and return `activeToday: false`.
8. **An appointment an administrator has marked `completed`** returns `completedToday: true` when today is still inside its date range, and `dailyVisitStatus: "completed"`.
9. **Cancelling an appointment that is already cancelled or completed is 422.** The first successful cancel is the one that stores the reason.
10. **Caregiver login accepts role `CAREGIVER` only**, with that exact spelling. `permissions` is always `[]` and the `user_permissions` table is not read for caregiver responses.
11. **Search** matches first name, last name, `"first last"`, phone, and email. `pageSize` above 100 is 422. A non-UUID path id is 404.
12. **List clients** return the lightweight card fields. Detail returns the nested profile. Appointment list and detail both embed the full client except diagnoses.
13. **Service requirement `startTime` and `endTime`** are calendar dates.
14. **Password hashing in tests** uses a lower Argon2 memory cost. The server and the bootstrap command use the production cost unless `NODE_ENV=test`.
15. **Local logout does not call the API**, so a refresh token remains valid until it expires, is rotated, or the user is deactivated. That matches the specification.
16. **Fixture ids such as `cg_alex` are examples.** Stored ids are UUID strings.

## Unimplemented endpoints

These paths exist in the Flutter constants or in the admin proposal. They are not implemented. No method or body was invented for them.

| Path | Why it is absent |
|---|---|
| `/auth/logout` | No HTTP method in the caregiver app. Logout stays on the device. |
| `/auth/forgot-password` | No caller and no agreed email, OTP, or reset-link contract. |
| `/auth/reset-password` | Same. An administrator sets the caregiver password. |
| `GET /care-plans/{id}` | The app navigates with the care plan it already parsed. |
| `POST /api/v1/admin/auth/login` | Implemented. |
| `GET /api/v1/admin/dashboard` | Not implemented. Administrator token receives 404. |
| `GET/POST /api/v1/admin/caregivers` | Not implemented. |
| `GET/PATCH /api/v1/admin/caregivers/{id}` | Not implemented. This is the future set-password route. |
| `GET/POST /api/v1/admin/clients` | Not implemented. |
| `GET/PATCH /api/v1/admin/clients/{id}` | Not implemented. |
| `PUT /api/v1/admin/clients/{id}/caregivers` | Not implemented. |
| Clinical and care-plan admin CRUD | Not implemented. Closed-set validators in `src/domain/enums.ts` are ready for those writes. |
| `GET/POST /api/v1/admin/appointments` | Not implemented. |
| `GET/PATCH /api/v1/admin/appointments/{id}` | Not implemented. |
| `GET /api/v1/admin/visits` | Not implemented. Check-ins, completions, daily visits, and cancellations are stored. |
| `GET /api/v1/admin/audit-log` | Not implemented. The `audit_log` table exists and caregiver requests do not write to it. |

Also out of scope: registration, file upload, push notifications, payments, exported reports, and any change to either Flutter app.

## Compatibility limits that are still open on the client

1. Cancel with `{ "appointmentStatus": "cancelled" }` returns 422 until the app sends `cancellationReason`.
2. Check-in without `appointmentId` returns 422 when two scheduled active appointments for that caregiver and client cover the date. Nothing is written.
3. A phone whose local date is not `America/Vancouver`'s date can send a `date` that does not match `completedToday`, because this app does not send `X-Timezone`.
