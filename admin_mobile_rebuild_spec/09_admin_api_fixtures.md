# 09 — Admin API Fixtures

Examples are reconstructed from `toJson` / `fromJson` in this app. Values are synthetic. They are not captured production traffic and they are not credentials.

Dates use the formats the app sends or parses. Tokens are placeholders.

## POST `/auth/login`

Request:

```json
{
  "email": "admin@example.com",
  "password": "placeholder-password"
}
```

Response the admin parser accepts:

```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "user": {
      "id": "user_admin_1",
      "email": "admin@example.com",
      "firstName": "Avery",
      "lastName": "Cole",
      "role": "ADMIN",
      "avatar": null,
      "permissions": []
    },
    "accessToken": "redacted-access-token",
    "refreshToken": "redacted-refresh-token",
    "expiresIn": 3600
  },
  "timestamp": "2026-06-05T15:04:05.000Z",
  "requestId": "req_example_1"
}
```

`permissions` is always `[]`. The app does not require any particular string. `role` must match `ADMIN` after uppercasing or the app discards this payload.

Error (`401`):

```json
{
  "message": "Invalid email or password",
  "code": "INVALID_CREDENTIALS",
  "errors": {},
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "fields": {}
  }
}
```

The login screen replaces `401` text with its own invalid-credentials string. Other statuses show `error.message`, falling back to `message`. The caregiver app reads the top-level `message` and does not read `error.message`.

## POST `/auth/refresh`

Request (no Authorization header):

```json
{
  "refreshToken": "redacted-refresh-token"
}
```

Response:

```json
{
  "success": true,
  "message": "",
  "data": {
    "accessToken": "redacted-access-token-2",
    "expiresIn": 3600
  }
}
```

`refreshToken` is omitted. **Decided:** the login refresh token is reused for 7 days and is not rotated. `expiresIn` is `3600`, and the app refreshes the access token at 55 minutes. `expiresIn: 0` signs the admin out.

## GET `/dashboard/stats`

```json
{
  "success": true,
  "data": {
    "totalClients": 12,
    "activeCarePlans": 9,
    "todayAppointments": 4,
    "totalCaregivers": 6,
    "completedAppointmentsToday": 1,
    "pendingAppointmentsToday": 3,
    "clientsGrowth": 0,
    "appointmentsGrowth": 0
  }
}
```

## POST `/clients`

Request:

```json
{
  "firstName": "Margaret",
  "lastName": "Anderson",
  "dateOfBirth": "1948-03-12",
  "phone": "+1-555-0100",
  "gender": "female",
  "emergencyContactName": "John Anderson",
  "emergencyContactRelation": "Son",
  "emergencyContactPhone": "+1-555-0101",
  "primaryCondition": "Type 2 Diabetes",
  "medicalConditions": ["Hypertension"],
  "allergies": ["Penicillin"],
  "language": "English",
  "communicationNote": "Speak slowly.",
  "address": {
    "street": "24 Maple Avenue",
    "city": "Brookline",
    "state": "MA",
    "zipCode": "02446",
    "country": "USA",
    "apartment": "",
    "gateAccessCode": "4421",
    "navigationInstructions": "Side door."
  }
}
```

## GET `/clients/{id}` and the `data` object of POST/PUT client

The list endpoint may wrap this object in one of the envelopes in the inventory. A detail/create/update body the parser accepts:

```json
{
  "success": true,
  "message": "",
  "data": {
    "id": "client_1",
    "firstName": "Margaret",
    "lastName": "Anderson",
    "dateOfBirth": "1948-03-12",
    "gender": "female",
    "phone": "+1-555-0100",
    "email": "margaret@example.com",
    "profileImage": null,
    "notes": "Speak slowly.",
    "status": "active",
    "createdAt": "2026-06-01T12:00:00.000Z",
    "updatedAt": "2026-06-05T12:00:00.000Z",
    "createdById": "user_admin_1",
    "updatedById": "user_admin_1",
    "deletedAt": null,
    "address": {
      "id": "addr_1",
      "street": "24 Maple Avenue",
      "apartment": "",
      "city": "Brookline",
      "state": "MA",
      "zipCode": "02446",
      "country": "USA",
      "gateAccessCode": "4421",
      "navigationInstructions": "Side door.",
      "latitude": null,
      "longitude": null
    },
    "emergencyContacts": [
      {
        "id": "ec_1",
        "name": "John Anderson",
        "relationship": "Son",
        "phone": "+1-555-0101",
        "email": null,
        "isPrimary": true,
        "clientId": "client_1",
        "createdAt": "2026-06-01T12:00:00.000Z",
        "updatedAt": "2026-06-01T12:00:00.000Z"
      }
    ],
    "diagnoses": [
      {
        "id": "dx_1",
        "name": "Type 2 Diabetes",
        "icdCode": null,
        "diagnosedDate": null,
        "severity": null,
        "notes": "Primary condition",
        "isActive": true,
        "clientId": "client_1"
      },
      {
        "id": "dx_2",
        "name": "Hypertension",
        "notes": "Medical condition",
        "isActive": true,
        "clientId": "client_1"
      },
      {
        "id": "dx_3",
        "name": "Penicillin",
        "notes": "Allergy",
        "isActive": true,
        "clientId": "client_1"
      }
    ],
    "languages": [
      {
        "id": "lang_1",
        "name": "English",
        "proficiency": null,
        "isPrimary": true,
        "clientId": "client_1"
      }
    ],
    "hazards": [
      {
        "id": "haz_1",
        "type": "environmental_risks",
        "description": "Loose rug in the hall",
        "isActive": true,
        "clientId": "client_1"
      }
    ],
    "serviceRequirements": [
      {
        "id": "sr_1",
        "category": "non_medical",
        "name": "Weekly Non-medical care",
        "description": null,
        "frequency": "weekly",
        "specialInstructions": "",
        "isActive": true,
        "clientId": "client_1"
      }
    ],
    "carePlans": [
      {
        "id": "cp_1",
        "name": "Daily Personal Care",
        "description": "Morning routine",
        "startDate": "2026-01-15",
        "endDate": "2026-12-31",
        "goals": ["Prevent falls"],
        "notes": null,
        "status": "active",
        "tasks": [
          {
            "id": "task_1",
            "name": "Morning walk",
            "description": "",
            "frequency": "daily"
          }
        ],
        "medications": [
          {
            "id": "med_1",
            "medicationName": "Metformin",
            "dosage": "500 mg",
            "schedule": "BD",
            "description": ""
          }
        ],
        "dietInstructions": [
          {
            "id": "diet_1",
            "meal": "Lunch",
            "restrictions": "Low sodium",
            "description": ""
          }
        ],
        "hygieneInstructions": [
          {
            "id": "hyg_1",
            "activity": "Shower",
            "frequency": "daily",
            "description": ""
          }
        ]
      }
    ],
    "appointments": [
      {
        "id": "appt_1",
        "title": "Morning visit",
        "description": "",
        "scheduledDate": "2026-06-05T00:00:00.000Z",
        "startTime": "09:00",
        "endTime": "10:00",
        "duration": 60,
        "appointmentType": "regular_visit",
        "appointmentStatus": "scheduled",
        "instructions": "",
        "caregiverId": "user_cg_1",
        "caregiver": {
          "firstName": "Sam",
          "lastName": "Rivera"
        }
      }
    ]
  }
}
```

`serviceRequirements[].category` is special-cased only for the care-category enum: the exact lowercase string `medical` becomes Medical, and every other value becomes Non-medical. The client’s care-type label is different: an empty category becomes `General Care`; any other category is shown with its first letter capitalized (`non_medical` → `Non_medical`). The example above uses `non_medical` only as an illustration, not as a confirmed server enum.

## GET `/clients?page=1&pageSize=50&search=margaret`

One accepted envelope (the parser also accepts a bare `data` array and several list keys):

```json
{
  "success": true,
  "message": "",
  "data": {
    "clients": [],
    "page": 1,
    "pageSize": 50,
    "total": 0,
    "totalPages": 0
  }
}
```

Replace `clients` with the detail objects above when the list is non-empty. `items`, `results`, or nested `data` are also accepted as the list key.

## PUT `/clients/{id}` — diagnosis or language edit

Same keys as POST `/clients`. No `email`. No `status`. `dateOfBirth` may be `""` if the cached value did not parse.

## PUT `/clients/{id}` — directions edit

```json
{
  "firstName": "Margaret",
  "lastName": "Anderson",
  "email": "margaret@example.com",
  "phone": "+1-555-0100",
  "dateOfBirth": "1948-03-12",
  "gender": "female",
  "status": "active",
  "address": {
    "street": "24 Maple Avenue",
    "city": "Brookline",
    "state": "MA",
    "zipCode": "02446",
    "country": "USA",
    "apartment": "",
    "gateAccessCode": "4421",
    "navigationInstructions": "Side door."
  }
}
```

## GET `/users/caregivers?page=1&pageSize=100`

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "user_cg_1",
        "firstName": "Sam",
        "lastName": "Rivera",
        "role": "Health Care Aide (HCA)",
        "phone": "+1-555-0199",
        "email": "sam.rivera@example.com",
        "avatar": null
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 100,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

`role` is the position label shown in the dropdown. It is not the auth role `CAREGIVER`. **Decided** starting positions: Health Care Aide (HCA), Care Aide / Personal Support Worker (PSW), Community Support Worker, Companion Caregiver, Home Support Worker, Respite Care Worker, Registered Nurse (RN), Licensed Practical Nurse (LPN), Sales Closer, Client Acquisition Specialist, Other. The admin web portal can add more. The phone cannot.

## GET `/appointments?page=1&pageSize=100`

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "appt_1",
        "scheduledDate": "2026-06-05T00:00:00.000Z",
        "startTime": "09:00",
        "endTime": "10:00",
        "clientName": "Margaret Anderson",
        "caregiverName": "Sam Rivera",
        "status": "scheduled",
        "type": "regular_visit"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 100,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

List `status` and `type` are the names the list parser reads. **Decided:** keep them. They are not renamed to `appointmentStatus` and `appointmentType`. Detail and caregiver payloads keep the longer names.

## GET `/appointments/types`

```json
{
  "success": true,
  "data": [
    { "value": "regular_visit", "label": "Regular Visit" },
    { "value": "doctor_visit", "label": "Doctor Visit" }
  ]
}
```

`doctor_visit` is included because the caregiver app special-cases it. **Decided for now:** this two-item catalog is the list the server returns. The admin app shows these labels. Doctor and clinic fields stay unread by the admin app.

## POST `/appointments`

```json
{
  "description": "Morning medication reminder",
  "clientId": "client_1",
  "caregiverId": "user_cg_1",
  "scheduledDate": "2026-06-05",
  "startTime": "09:00",
  "endTime": "10:00",
  "appointmentType": "regular_visit",
  "instructions": "Morning medication reminder",
  "notes": "Family prefers the side door.",
  "locationStreet": "24 Maple Avenue",
  "locationCity": "Brookline",
  "locationState": "MA",
  "locationZipCode": "02446",
  "locationGateCode": "4421",
  "locationNavigation": "Navigation Instructions: Side door."
}
```

Minimal success the app can use:

```json
{
  "success": true,
  "data": { "id": "appt_1" }
}
```

Any other 2xx body is also treated as success. A missing id is replaced with a local `ap_<microseconds>` id.

## PUT `/appointments/{id}`

```json
{
  "description": "Morning medication reminder",
  "caregiverId": "user_cg_1",
  "scheduledDate": "2026-06-05",
  "startTime": "09:00",
  "endTime": "10:30",
  "appointmentStatus": "scheduled",
  "appointmentType": "regular_visit",
  "instructions": "Morning medication reminder",
  "notes": "Family prefers the side door.",
  "locationStreet": "24 Maple Avenue",
  "locationCity": "Brookline",
  "locationState": "MA",
  "locationZipCode": "02446",
  "locationGateCode": "4421",
  "locationNavigation": "Navigation Instructions: Side door."
}
```

The response body is ignored.

## GET `/appointments/{id}`

```json
{
  "success": true,
  "data": {
    "id": "appt_1",
    "description": "Morning medication reminder",
    "scheduledDate": "2026-06-05T00:00:00.000Z",
    "startTime": "09:00",
    "endTime": "10:00",
    "duration": 60,
    "appointmentType": "regular_visit",
    "appointmentStatus": "scheduled",
    "instructions": "Morning medication reminder",
    "notes": "Family prefers the side door.",
    "checkInTime": null,
    "checkOutTime": null,
    "status": "",
    "locationStreet": "24 Maple Avenue",
    "locationCity": "Brookline",
    "locationState": "MA",
    "locationZipCode": "02446",
    "locationGateCode": "4421",
    "locationNavigation": "Navigation Instructions: Side door.",
    "clientId": "client_1",
    "caregiverId": "user_cg_1",
    "carePlanId": "cp_1",
    "createdAt": "2026-06-01T12:00:00.000Z",
    "updatedAt": "2026-06-05T12:00:00.000Z",
    "client": {
      "id": "client_1",
      "firstName": "Margaret",
      "lastName": "Anderson",
      "phone": "+1-555-0100",
      "email": "margaret@example.com",
      "emergencyContacts": [],
      "carePlans": []
    },
    "caregiver": {
      "id": "user_cg_1",
      "firstName": "Sam",
      "lastName": "Rivera",
      "phone": "+1-555-0199",
      "email": "sam.rivera@example.com",
      "emergencyContacts": [],
      "carePlans": []
    },
    "tasks": [
      {
        "id": "atask_1",
        "title": "Confirm medications",
        "description": "",
        "isCompleted": false
      }
    ]
  }
}
```

## DELETE `/appointments/{id}`

No body. Any 2xx is success. Body ignored.

## POST `/care-plans`

```json
{
  "clientId": "client_1",
  "name": "Daily Personal Care",
  "description": "Morning routine",
  "startDate": "2026-01-15",
  "endDate": "2026-12-31",
  "goals": ["Prevent falls"],
  "status": "active"
}
```

Omit `startDate` and `endDate` when the user did not pick them.

```json
{
  "success": true,
  "message": "",
  "data": {
    "id": "cp_1",
    "name": "Daily Personal Care",
    "description": "Morning routine",
    "startDate": "2026-01-15",
    "endDate": "2026-12-31",
    "goals": ["Prevent falls"],
    "status": "active"
  }
}
```

## Care plan items

Diet — `POST /care-plans/cp_1/diet`:

```json
{ "meal": "Lunch", "restrictions": "Low sodium", "description": "" }
```

Medication — `POST /care-plans/cp_1/medications`:

```json
{
  "medicationName": "Metformin",
  "dosage": "500 mg",
  "schedule": "BD",
  "description": ""
}
```

Hygiene — `POST /care-plans/cp_1/hygiene`:

```json
{ "activity": "Shower", "frequency": "daily", "description": "" }
```

Task — `POST /care-plans/cp_1/tasks`:

```json
{ "name": "Morning walk", "frequency": "daily", "description": "" }
```

A 2xx response with `data.id` is ideal. Medication, hygiene, and task calls still count as success when `data` is missing. Diet does not.

## Hazards

`POST /clients/client_1/hazards`:

```json
{
  "type": "environmental_risks",
  "description": "Loose rug in the hall"
}
```

`GET /clients/client_1/hazards` accepted shapes include:

```json
{
  "data": [
    {
      "id": "haz_1",
      "type": "environmental_risks",
      "description": "Loose rug in the hall"
    }
  ]
}
```

`DELETE /clients/client_1/hazards/haz_1` has no body. Any 2xx succeeds.

## Validation error (`422`)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "End time must be after start time",
    "fields": {
      "endTime": "End time must be after start time"
    }
  }
}
```

The snackbar shows `message` only. `fields` is stored on the exception and not rendered field-by-field.
