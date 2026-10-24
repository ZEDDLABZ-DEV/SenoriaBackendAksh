# 11 — API Contract Fixtures

Sanitized examples derived from `fromJson` parsers and `DemoData`. They are not captures from production. Names, phones, emails, and tokens are fake. Do not replace them with live credentials.

All success examples show the full HTTP body. `ApiClient` returns only `data`.

---

## Login success

`POST /api/v1/auth/login`

Request:

```json
{
  "email": "alex.rivera@example.com",
  "password": "example-password",
  "role": "CAREGIVER"
}
```

Response `200`:

```json
{
  "message": "Signed in",
  "data": {
    "user": {
      "id": "cg_alex",
      "email": "alex.rivera@example.com",
      "firstName": "Alex",
      "lastName": "Rivera",
      "role": "CAREGIVER",
      "avatar": null,
      "permissions": []
    },
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example",
    "expiresIn": 86400
  }
}
```

`accessToken` is a JWT lasting 24 hours. `refreshToken` is opaque and lasts 30 days. `permissions` is always `[]`. The demo stub in the app used `expiresIn: 3600`; the server sends `86400`. The app parses the number and does not store it.

## Login unauthorized

Response `401`:

```json
{
  "message": "Invalid email or password",
  "code": "INVALID_CREDENTIALS"
}
```

The app ignores this `message` for 401 and shows its own invalid-credentials string. `code` is optional.

## Login validation

Response `422`:

```json
{
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": {
    "email": ["Email is not valid"],
    "password": "Password must be at least 6 characters"
  }
}
```

A string or an array is valid for each `errors` value.

## Role not allowed

Prefer `403` so tokens are not issued:

```json
{
  "message": "This account cannot use the caregiver app",
  "code": "ROLE_NOT_ALLOWED"
}
```

If the server returns 200 with a non-caregiver `user.role`, the app discards the session itself.

## Refresh success

`POST /api/v1/auth/refresh`

Request:

```json
{
  "refreshToken": "refresh-token-example"
}
```

Response `200`:

```json
{
  "message": "Token refreshed",
  "data": {
    "accessToken": "access-token-example-2",
    "refreshToken": "refresh-token-example-2",
    "expiresIn": 86400
  }
}
```

`accessToken` must be a non-empty JWT. `refreshToken` must be a new non-empty opaque token. An empty `refreshToken` would make the app keep the previous token, which this response has already invalidated. Reuse of `refresh-token-example` then returns 401.

## Refresh failure

Response `401`:

```json
{
  "message": "Your session has expired. Please log in again.",
  "code": "REFRESH_EXPIRED"
}
```

## Authenticated call without a token

Response `401`:

```json
{
  "message": "Your session has expired. Please log in again.",
  "code": "UNAUTHENTICATED"
}
```

---

## Appointments list

`GET /api/v1/appointments/caregiver/cg_alex`

Response `200`. `data` is an array. This fixture includes one of each visit state the UI branches on.

```json
{
  "message": "ok",
  "data": [
    {
      "id": "appt_today",
      "description": "Morning personal care and medication.",
      "scheduledDate": "2026-10-19",
      "endDate": "2026-11-02",
      "startTime": "09:00",
      "endTime": "10:30",
      "duration": 90,
      "appointmentType": "personal_care",
      "appointmentStatus": "scheduled",
      "instructions": "Confirm breakfast before the morning tablets.",
      "notes": "Family may call during the visit.",
      "checkInTime": null,
      "checkOutTime": null,
      "cancellationReason": null,
      "status": "active",
      "locationStreet": "1284 Maple Street",
      "locationCity": "Surrey",
      "locationState": "BC",
      "locationZipCode": "V3T 2W1",
      "locationGateCode": "4821",
      "locationNavigation": "Use the side entrance. Ring the bell twice.",
      "clientId": "client_margaret",
      "caregiverId": "cg_alex",
      "carePlanId": "plan_margaret",
      "completedToday": false,
      "activeToday": true,
      "dailyVisitStatus": "pending",
      "client": {
        "id": "client_margaret",
        "firstName": "Margaret",
        "lastName": "Chen",
        "dateOfBirth": "1948-03-14",
        "gender": "female",
        "phone": "(604) 555-0101",
        "email": "margaret.chen@example.com",
        "profileImage": null,
        "notes": "Prefers tea before medication.",
        "status": "active",
        "languages": [
          { "name": "English", "proficiency": "native", "isPrimary": true }
        ],
        "hazards": [
          {
            "type": "fall_risk",
            "description": "Unsteady on stairs.",
            "severity": "moderate",
            "precautions": "Stay within arm's reach during transfers.",
            "isActive": true
          }
        ],
        "emergencyContacts": [
          {
            "name": "Lisa Chen",
            "relationship": "Daughter",
            "phone": "(604) 555-0102",
            "email": "lisa.chen@example.com",
            "isPrimary": true
          }
        ],
        "serviceRequirements": [
          {
            "id": "svc_margaret_1",
            "service": "personal_care",
            "startTime": "2026-09-19",
            "endTime": "2027-01-17"
          }
        ],
        "carePlans": [
          {
            "id": "plan_margaret",
            "name": "Daily Living Support",
            "description": "Morning personal care and a light mobility routine.",
            "status": "active",
            "notes": "Review anything unusual with the family after the visit.",
            "startDate": "2026-09-28",
            "endDate": "2026-12-18",
            "goals": [
              "Keep the daily routine calm and predictable",
              "Support medication at the scheduled time"
            ],
            "tasks": [
              {
                "id": "task_margaret_1",
                "name": "Mobility walk",
                "frequency": "Daily",
                "description": "A short supervised walk.",
                "completedToday": false
              }
            ],
            "medications": [
              {
                "id": "med_margaret_1",
                "medicationName": "Lisinopril",
                "dosage": "10 mg",
                "schedule": "With breakfast",
                "description": "Give with water after food.",
                "completedToday": false
              }
            ],
            "dietInstructions": [
              {
                "id": "diet_margaret_1",
                "meal": "Breakfast",
                "restrictions": "Low sodium",
                "description": "Offer tea or water.",
                "completedToday": false
              }
            ],
            "hygieneInstructions": [
              {
                "id": "hyg_margaret_1",
                "activity": "Morning wash",
                "frequency": "Daily",
                "description": "Assist with face, hands, and oral care.",
                "completedToday": false
              }
            ]
          }
        ]
      },
      "caregiver": {
        "firstName": "Alex",
        "lastName": "Rivera",
        "phone": "(604) 555-0148",
        "email": "alex.rivera@example.com"
      }
    }
  ]
}
```

## Empty appointment list

```json
{
  "message": "ok",
  "data": []
}
```

## Appointment not found

`404`:

```json
{
  "message": "The requested resource was not found.",
  "code": "NOT_FOUND"
}
```

## Forbidden scope

`403`:

```json
{
  "message": "You do not have permission to do that.",
  "code": "FORBIDDEN"
}
```

---

## Clients list page 1

`GET /api/v1/clients/caregiver/cg_alex?page=1&pageSize=10&status=active`

```json
{
  "message": "ok",
  "data": {
    "data": [
      {
        "id": "client_margaret",
        "firstName": "Margaret",
        "lastName": "Chen",
        "dateOfBirth": "1948-03-14",
        "gender": "female",
        "phone": "(604) 555-0101",
        "email": "margaret.chen@example.com",
        "profileImage": null,
        "notes": "Prefers tea before medication.",
        "status": "active"
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "pageSize": 10,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

The list may include the same nested objects as the detail. The card only needs the fields above.

## Clients list empty search

`GET ...?page=1&pageSize=10&status=active&search=zzzz`

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

## Clients list page 2

`meta.hasNextPage` on page 1 must be true when `total` is greater than `pageSize`. Page 2 of 11 clients returns the remaining row, not an empty array:

```json
{
  "message": "ok",
  "data": {
    "data": [
      {
        "id": "client_11",
        "firstName": "Nora",
        "lastName": "Singh",
        "dateOfBirth": "1944-02-02",
        "gender": "female",
        "phone": "(604) 555-0111",
        "email": null,
        "profileImage": null,
        "notes": "",
        "status": "active"
      }
    ],
    "meta": {
      "total": 11,
      "page": 2,
      "pageSize": 10,
      "totalPages": 2,
      "hasNextPage": false,
      "hasPreviousPage": true
    }
  }
}
```

---

## Client detail

`GET /api/v1/clients/client_margaret`

Nullable fields are explicit nulls. Omitting them is also valid.

```json
{
  "message": "ok",
  "data": {
    "id": "client_margaret",
    "firstName": "Margaret",
    "lastName": "Chen",
    "dateOfBirth": "1948-03-14",
    "gender": "female",
    "phone": "(604) 555-0101",
    "email": null,
    "profileImage": null,
    "notes": "Prefers tea before medication.",
    "status": "active",
    "address": {
      "street": "1284 Maple Street",
      "apartment": "Apt 2",
      "city": "Surrey",
      "state": "BC",
      "zipCode": "V3T 2W1",
      "country": "Canada",
      "gateAccessCode": "4821",
      "navigationInstructions": "Use the side entrance. Ring the bell twice."
    },
    "languages": [
      { "name": "English", "proficiency": "native", "isPrimary": true }
    ],
    "emergencyContacts": [
      {
        "name": "Lisa Chen",
        "relationship": "Daughter",
        "phone": "(604) 555-0102",
        "email": null,
        "isPrimary": true
      }
    ],
    "diagnoses": [
      {
        "id": "dx_1",
        "name": "Hypertension",
        "icdCode": "I10",
        "diagnosedDate": "2018-04-12",
        "severity": "moderate",
        "notes": "Controlled with daily medication.",
        "isActive": true
      },
      {
        "id": "dx_2",
        "name": "Penicillin allergy",
        "icdCode": "Z88.0",
        "diagnosedDate": "1995-06-01",
        "severity": "high",
        "notes": "Do not administer penicillin.",
        "isActive": true
      }
    ],
    "hazards": [
      {
        "type": "fall_risk",
        "description": "Unsteady on stairs.",
        "severity": "moderate",
        "precautions": "Stay within arm's reach during transfers.",
        "isActive": true
      }
    ],
    "carePlans": [
      {
        "id": "plan_margaret",
        "name": "Daily Living Support",
        "description": "Morning personal care and a light mobility routine.",
        "status": "active",
        "notes": "",
        "startDate": "2026-09-28",
        "endDate": "2026-12-18",
        "goals": ["Support medication at the scheduled time"],
        "tasks": [],
        "medications": [],
        "dietInstructions": [],
        "hygieneInstructions": []
      }
    ],
    "appointments": [
      {
        "id": "appt_today",
        "description": "Scheduled caregiver visit",
        "scheduledDate": "2026-10-19",
        "startTime": "09:00",
        "endTime": "10:00",
        "appointmentType": "personal_care",
        "appointmentStatus": "scheduled",
        "caregiver": { "firstName": "Alex", "lastName": "Rivera" }
      },
      {
        "id": "appt_doctor",
        "description": "Follow-up with the family physician",
        "scheduledDate": "2026-10-24",
        "startTime": "13:30",
        "endTime": "14:00",
        "appointmentType": "doctor_visit",
        "appointmentStatus": "scheduled",
        "doctorName": "Dr. Priya Shah",
        "doctorSpecialty": "Family medicine",
        "doctorPhone": "(604) 555-2210",
        "clinicName": "Example Family Clinic",
        "caregiver": { "firstName": "Alex", "lastName": "Rivera" }
      }
    ]
  }
}
```

---

## Check-in

`POST /api/v1/care-plans/plan_margaret/check-in`

Request the current app sends. There is no `appointmentId` and no `X-Timezone` header.

```json
{
  "timestamp": "2026-10-19T16:05:00.000Z",
  "location": {
    "latitude": 49.1913,
    "longitude": -122.849
  },
  "date": "2026-10-19"
}
```

This succeeds when exactly one of this caregiver's `scheduled`, `active` appointments for that care plan's client covers `2026-10-19`. Two such appointments return 422 and write nothing. A future client may add `appointmentId`. The current controller does not.

Response `200`. The app ignores `data` and refetches. `data` is still the full appointment, with the same keys as an appointment list element. The fields that change are:

```json
{
  "message": "Checked in",
  "data": {
    "id": "appt_today",
    "checkInTime": "2026-10-19T16:05:00.000Z",
    "checkOutTime": null,
    "completedToday": false,
    "activeToday": true,
    "dailyVisitStatus": "pending"
  }
}
```

The snippet above shows the changed fields. The real `data` object also includes every other `AppointmentModel` field from the list fixture. `dailyVisitStatus` stays `pending`. `DemoData.markCheckedIn` sets `in_progress`; do not copy that.

The following GET uses the same changed fields. The open screen also keeps the per-plan check-in in memory. A cold reopen knows only appointment-level `checkInTime`.

## Care-plan item toggle

`POST /api/v1/care-plans/plan_margaret/completions/toggle`

Request:

```json
{
  "itemType": "task",
  "itemId": "task_margaret_1",
  "date": "2026-10-19"
}
```

Response `200`:

```json
{
  "message": "Updated",
  "data": {
    "completed": true
  }
}
```

A second call:

```json
{
  "message": "Updated",
  "data": {
    "completed": false
  }
}
```

Other `itemType` values: `medication`, `diet`, `hygiene`.

## Daily completion

`POST /api/v1/appointments/appt_today/daily-completion/toggle`

Request:

```json
{
  "date": "2026-10-19"
}
```

Response `200` (the app does not parse `data`; this record matches the source comment):

```json
{
  "message": "Visit completed",
  "data": {
    "appointmentId": "appt_today",
    "date": "2026-10-19",
    "completed": true
  }
}
```

The following GET must show `completedToday: true` when `date` is the current day in `X-Timezone` or, with no header, `America/Vancouver`. It also shows `dailyVisitStatus: "completed"`, `activeToday: false`, and a non-empty `checkOutTime`. `appointmentStatus` stays `scheduled` until every day in the range is completed. A second POST with the same `date` returns `completed: true` again and does not undo the visit.

## Cancel

`PUT /api/v1/appointments/appt_today`

Request the current app sends. This body is incompatible with the decided rule and returns 422:

```json
{
  "appointmentStatus": "cancelled"
}
```

Required body. The current app does not send `cancellationReason`. Flutter must add the reason the dialog already collected:

```json
{
  "appointmentStatus": "cancelled",
  "cancellationReason": "Family requested a different day."
}
```

Response `422` for the current body. `message` and `errors` use the existing error object. The sentence below is an example; the app displays the server's `message`.

```json
{
  "message": "A cancellation reason is required",
  "code": "VALIDATION_ERROR",
  "errors": {
    "cancellationReason": ["A cancellation reason is required"]
  }
}
```

Response `200` for the required body. The app parses this as an appointment because `data` contains `id`. `cancellationReason` is shown when status is cancelled and the trimmed text is non-empty.

```json
{
  "message": "Appointment cancelled",
  "data": {
    "id": "appt_today",
    "description": "Morning personal care and medication.",
    "scheduledDate": "2026-10-19",
    "endDate": "2026-11-02",
    "startTime": "09:00",
    "endTime": "10:30",
    "duration": 90,
    "appointmentType": "personal_care",
    "appointmentStatus": "cancelled",
    "instructions": "Do not attend.",
    "notes": "",
    "checkInTime": "2026-10-19T16:05:00.000Z",
    "checkOutTime": null,
    "cancellationReason": "Family requested a different day.",
    "status": "active",
    "locationStreet": "1284 Maple Street",
    "locationCity": "Surrey",
    "locationState": "BC",
    "locationZipCode": "V3T 2W1",
    "locationGateCode": "4821",
    "locationNavigation": "Use the side entrance.",
    "clientId": "client_margaret",
    "caregiverId": "cg_alex",
    "carePlanId": "plan_margaret",
    "completedToday": false,
    "activeToday": false,
    "dailyVisitStatus": "cancelled",
    "client": {
      "id": "client_margaret",
      "firstName": "Margaret",
      "lastName": "Chen"
    },
    "caregiver": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "phone": "(604) 555-0148",
      "email": "alex.rivera@example.com"
    }
  }
}
```

## Server error

`500`:

```json
{
  "message": "Something went wrong. Please try again later.",
  "code": "SERVER_ERROR"
}
```

## Alternate keys the parser accepts

Care plan title instead of name:

```json
{ "id": "plan_1", "title": "Daily Living Support", "goals": "Stay hydrated" }
```

`goals` as objects:

```json
{ "goals": [{ "description": "Stay hydrated" }, { "title": "Safe transfers" }] }
```

Medication alternate keys:

```json
{ "id": "med_1", "name": "Vitamin D", "frequency": "Once daily", "completedToday": false }
```
