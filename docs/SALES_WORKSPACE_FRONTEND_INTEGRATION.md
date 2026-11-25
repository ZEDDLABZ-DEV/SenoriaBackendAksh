# Sales workspace API — frontend integration

**Give this file to Cursor in the Senoria Admin frontend.** It describes the sales workspace APIs that are now implemented. Replace the mock data in Today, Leads, Calls, Calendar, and Salespeople with these calls.

**Do not build:** Meta, RingCentral, Zoho, Outlook, click-to-call, or a composite `GET /sales/today`. The screens compose the endpoints below. `GET /calls/summary` does not exist; count results from the call list.

---

## Prompt to paste in the frontend repo

```text
Wire the Senoria Admin sales workspace screens to the live API using docs/SALES_WORKSPACE_FRONTEND_INTEGRATION.md (copy it into this repo first, or keep it open).

Replace mock data in Today, Leads, Calls, Calendar, and Salespeople. Keep the existing sales account screens. Match the response shapes in that document, especially the nested list envelope (body.data.data and body.data.meta). Do not call third-party integrations. Format dates in the UI; the API returns ISO timestamps and YYYY-MM-DD / HH:mm inputs.
```

---

## Conventions

| Rule | Value |
|------|--------|
| Base path | `/api/v1` |
| Auth | `Authorization: Bearer <accessToken>` |
| Timezone header | `X-Timezone: America/Vancouver` (IANA). Used when `timeZoneOffset` is omitted. Invalid or missing header falls back to `America/Vancouver`. |
| Day boundary query | `timeZoneOffset=+05:30` or `-08:00`. When present, it wins over `X-Timezone` for queue “today”, follow-up datetimes, call date filters, and meeting date ranges. |
| JSON | camelCase |
| Success | `{ "success": true, "message": string, "data": ..., "timestamp": string, "requestId": string }` |
| Paginated lists | `data` is `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages", "hasNextPage", "hasPreviousPage" } }`. Read rows from `body.data.data` and paging from `body.data.meta`. Same shape as `GET /users/sales`. |
| Unpaginated lists | Meetings and salespeople: `body.data` is the array itself. |
| Errors | HTTP status plus `{ "message", "code", "errors": { "field": ["..."] }, "error": { "message", "code", "fields": { "field": "first message" } } }` |
| Roles | `ADMIN` sees every lead, call, and meeting. `SALES` is limited as noted on each route. `CAREGIVER` receives `403`. |
| Timestamps | ISO 8601 UTC. Never relative strings. |
| Form dates | `YYYY-MM-DD` |
| Form times | `HH:mm` (24-hour) |

| Status | When |
|--------|------|
| `401` | Missing or invalid token |
| `403` | Wrong role, or a sales user touching a lead, call, or meeting they do not own |
| `404` | Unknown id, or a meeting that was deleted |
| `422` | Validation. Use `errors` for field messages. |

---

## Enums

```ts
type LeadStage = "New" | "Contacted" | "Qualified" | "Visit booked" | "Won" | "Lost";
type LeadSource = "Facebook" | "Instagram" | "Phone" | "Referral";
type QueueFilter = "new" | "due" | "overdue" | "mine";
type NoteOutcome = "Connected" | "No answer" | "Voicemail" | "Booked";
type CallDirection = "Outbound" | "Inbound";
type CallResult = "Connected" | "No answer" | "Voicemail" | "Missed";
type MeetingKind = "Call" | "Visit";
type TimelineKind = "Lead" | "Call" | "Note" | "Meeting" | "Stage" | "Assignment";
```

Closed stages are `Won` and `Lost`. They stay in lists and in `mine`, and they are excluded from `due` and `overdue`.

`queues` on a lead is computed for the signed-in user:

| Queue | Rule |
|-------|------|
| `new` | `stage === "New"` |
| `due` | `nextStepAt` falls on the viewer’s today, and stage is not closed |
| `overdue` | `nextStepAt` is before the start of today, and stage is not closed |
| `mine` | `ownerId ===` the signed-in user. An admin who does not own the lead does not get `mine`. |

A lead can be in more than one queue.

---

## Screens

| Screen | Calls |
|--------|--------|
| Today | `GET /leads?queue=`, `GET /leads/:id`, `PATCH /leads/:id/stage`, `POST /leads/:id/notes`, `POST /leads/:id/assign` (admin), `GET /leads/queues/summary`, `GET /sales/meetings?from&to` for the sidebar |
| Leads | `GET /leads`, `POST /leads/:id/assign` (admin), `GET /sales/assignment-state` |
| Calls | `GET /calls`, `GET /calls/:id`. Log a finished call with `POST /calls`. There is no dial endpoint. |
| Calendar | `GET /sales/meetings?from&to`, `POST`, `PATCH`, `DELETE` |
| Salespeople | `GET /salespeople`, `GET /salespeople/:id` (admin) |
| Sales account detail | `GET /users/sales/:id` instead of scanning `GET /users/sales` |

Send `timeZoneOffset` from the browser (`+05:30` style) on queue, summary, call range, and meeting range requests so “today” matches the admin’s clock.

---

## Leads

### `GET /leads`

Auth: `ADMIN` or `SALES`.

Query: `page` (default 1), `pageSize` (default 50, max 100), `stage?`, `ownerId?`, `queue?` (`new` \| `due` \| `overdue` \| `mine`), `search?` (name, phone, email, or `"First Last"`), `timeZoneOffset?`.

A sales user only receives their own leads. A foreign `ownerId` is ignored. An admin can filter `ownerId`. `queue=mine` means owned by the signed-in user, so an admin using that filter sees only leads they personally own.

`201` is not used. Success message is `"ok"`.

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "data": [
      {
        "id": "uuid",
        "firstName": "Maria",
        "lastName": "Chen",
        "phone": "416-555-0142",
        "email": "maria.chen@email.com",
        "source": "Facebook",
        "stage": "New",
        "ownerId": "uuid-or-null",
        "ownerName": "Amy Alpha",
        "about": "Daughter asking about weekday morning care",
        "lastTouchAt": "2026-11-20T13:02:00.000Z",
        "nextStep": "Intro call today at 9:30",
        "nextStepAt": "2026-11-20T14:30:00.000Z",
        "queues": ["new", "due"],
        "createdAt": "2026-11-20T13:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 50,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

`ownerId`, `ownerName`, `email`, `lastTouchAt`, and `nextStep` / `nextStepAt` are `null` when unset. Newest leads come first.

### `GET /leads/:id`

Auth: admin, or the owning sales user. `404` if missing. `403` if a sales user does not own it.

`data` is the list item plus `updatedAt` and `timeline` (oldest first):

```json
{
  "id": "uuid",
  "kind": "Note",
  "text": "Spoke with her daughter",
  "occurredAt": "2026-11-20T13:02:00.000Z",
  "actorId": "uuid-or-null",
  "meta": { "outcome": "Connected" }
}
```

`meta` is `null` when the event has no extra payload. Note events store `{ "outcome": "Connected" | "No answer" | "Voicemail" | "Booked" }`. Meeting events store `{ "meetingKind": "Call" | "Visit" }`. A removed meeting stores `{ "meetingKind": "...", "removed": true }`.

Show `text` in the timeline. Intake text looks like `Lead received from a Facebook lead ad.` Stage text is `Moved to Contacted.`

### `POST /leads`

Auth: **admin only**. `201`, message `"Lead created"`. `data` is the lead detail (with timeline).

```json
{
  "firstName": "Maria",
  "lastName": "Chen",
  "phone": "416-555-0142",
  "email": "maria.chen@email.com",
  "source": "Facebook",
  "about": "optional",
  "ownerId": "optional sales user uuid"
}
```

`firstName`, `lastName`, `phone`, and `source` are required. Omit `ownerId` to round-robin among **active** sales users (last name, first name, id). Inactive users are skipped. If nobody is active, the lead is created with `ownerId: null` and a timeline line `No active sales executive for round-robin.` Sending `ownerId` assigns that sales user even when inactive, and does not move the round-robin cursor. A non-sales `ownerId` is `422` on `ownerId`.

### `PATCH /leads/:id`

Auth: admin or owning sales user. Message `"Lead updated"`. `data` is the lead detail.

All fields optional: `about`, `phone`, `email` (`null` or `""` clears it), `nextStep` (`null` clears it), `nextStepAt` (ISO, or `null` to clear). This route does not change `stage` or `ownerId`.

### `PATCH /leads/:id/stage`

Auth: admin or owning sales user. Message `"Stage updated"`.

```json
{ "stage": "Contacted" }
```

Sets `lastTouchAt` and appends `Moved to {stage}.`

### `POST /leads/:id/assign`

Auth: **admin only**. Message `"Lead assigned"`.

```json
{ "ownerId": "sales-user-uuid" }
```

The target may be inactive. Unknown or non-sales owners are `422`.

### `POST /leads/:id/notes`

Auth: admin or owning sales user. Message `"Note added"`. `data` is the lead detail. When `followUpDate` is sent, `data.meetingId` is also set.

```json
{
  "outcome": "Connected",
  "text": "Spoke with her daughter",
  "followUpDate": "2026-10-20",
  "followUpTime": "10:00",
  "stage": "Qualified"
}
```

`outcome` and `text` are required. `followUpTime` without `followUpDate` is `422`. If only the date is sent, the time defaults to `09:00`. That sets:

- `nextStep` to `Follow-up call on 2026-10-20 at 10:00`
- `nextStepAt` from that local date and time (`timeZoneOffset`, otherwise `X-Timezone`)
- a 30-minute meeting with `kind: "Call"`, the same title, and `meetingId` on the response

`stage` is applied only when it differs from the current stage, and then a Stage timeline event is added.

### `GET /leads/queues/summary`

Auth: admin or sales. Query: `timeZoneOffset?`, `ownerId?` (admin only; sales users are forced to themselves).

```json
{ "new": 2, "due": 3, "overdue": 1, "mine": 5 }
```

Sales: all four counts are that user’s leads. `mine` includes won and lost.

Admin: `new`, `due`, and `overdue` are global. `mine` is leads owned by `ownerId` when that query is present, otherwise leads owned by the admin (usually `0`). Won and lost never increment `due` or `overdue`.

### `GET /sales/assignment-state`

Auth: admin or sales. Message `"ok"`.

```json
{
  "activeRepIds": ["uuid-amy", "uuid-bea"],
  "nextOwnerId": "uuid-bea",
  "nextOwnerName": "Bea Beta"
}
```

Use this for the Leads banner (“Next lead goes to Bea Beta”). `nextOwnerId` and `nextOwnerName` are `null` when there is no active sales user. Order is last name, first name, id. Inactive users are absent from `activeRepIds`.

---

## Calls

There is no click-to-call. `recordingAvailable` stays `false` until a later sync stores a URL, and only when `result` is `Connected`.

### `GET /calls`

Auth: admin or sales. Query: `page`, `pageSize` (default 50, max 100), `from?`, `to?`, `ownerId?`, `leadId?`, `result?`, `direction?`, `timeZoneOffset?`.

`from` and `to` are `YYYY-MM-DD` or an ISO datetime. A date includes that whole local day. An ISO `from` is inclusive. An ISO `to` is inclusive.

A sales user sees calls whose lead they own, plus every unmatched inbound (`leadId: null`). Another rep’s lead calls are omitted from the list and return `403` on detail.

Paginated like leads (`body.data.data`, `body.data.meta`). Newest `when` first.

```json
{
  "id": "uuid",
  "when": "2026-11-19T20:14:00.000Z",
  "leadId": "uuid-or-null",
  "name": "Maria Chen",
  "phone": "416-555-0142",
  "direction": "Outbound",
  "durationSeconds": 252,
  "durationLabel": "4 min 12 sec",
  "result": "Connected",
  "recordingAvailable": false,
  "ownerId": "uuid-or-null",
  "ownerName": "Amy Alpha"
}
```

`durationLabel` is `null` when `durationSeconds` is `null`. Otherwise it is `{n} sec` or `{n} min {n} sec`.

### `GET /calls/:id`

Same visibility as the list. `data` adds `startedAt` (same instant as `when`), `endedAt` (`null` if still open), and `recordingUrl` (`null` today).

### `POST /calls`

Auth: admin or sales. `201`, message `"Call logged"`. `data` is the call detail.

```json
{
  "leadId": "uuid-or-null-or-omit",
  "phone": "416-555-0142",
  "direction": "Outbound",
  "startedAt": "2026-11-19T20:14:00.000Z",
  "endedAt": "2026-11-19T20:18:12.000Z",
  "durationSeconds": 252,
  "result": "Connected",
  "name": "optional"
}
```

`phone`, `direction`, `startedAt`, and `result` are required. If `durationSeconds` is omitted and both times are sent, the server computes it. `endedAt` before `startedAt` is `422`.

When `leadId` is set, the server checks access, defaults `name` to the lead’s full name, sets `ownerId` from the lead owner, appends a `Call` timeline event (`Outbound call, Connected.`), and refreshes `lastTouchAt`. Omit `leadId` for an unmatched call: `name` defaults to `Unknown caller` and `ownerId` is the person who logged it.

---

## Meetings

### `GET /sales/meetings`

Auth: admin or sales. **Required** query: `from` and `to` as `YYYY-MM-DD`. Optional: `ownerId` (admin only), `timeZoneOffset`. Missing dates are `422`. `to` before `from` is `422`.

`body.data` is an **array**, not a paginated object. Sales users only receive meetings they own. Deleted meetings are omitted. A meeting is included when it overlaps the inclusive local date range. Ordered by `startAt`.

```json
{
  "id": "uuid",
  "leadId": "uuid-or-null",
  "ownerId": "uuid",
  "title": "Home visit",
  "person": "Helen Wright",
  "kind": "Visit",
  "startAt": "2026-10-20T19:30:00.000Z",
  "endAt": "2026-10-20T20:30:00.000Z"
}
```

### `POST /sales/meetings`

Auth: admin or sales. `201`, message `"Meeting created"`.

```json
{
  "leadId": "uuid",
  "title": "Home visit",
  "kind": "Visit",
  "startAt": "2026-10-20T19:30:00.000Z",
  "endAt": "2026-10-20T20:30:00.000Z"
}
```

`leadId` is required. A sales user must own that lead. `person` is the lead’s full name. `ownerId` becomes the lead’s owner, or the signed-in user if the lead is unassigned. `endAt` must be after `startAt`. The lead’s `nextStep` becomes `title`, `nextStepAt` becomes `startAt`, and the timeline gains `{kind} scheduled: {title}.`

### `PATCH /sales/meetings/:id`

Auth: admin or the meeting owner. Message `"Meeting updated"`. Partial body: `title`, `kind`, `startAt`, `endAt`, `leadId`. A sales user cannot point it at someone else’s lead.

### `DELETE /sales/meetings/:id`

Auth: admin or the meeting owner. Message `"Meeting deleted"`. `data` is `{ "id": "uuid" }`. The row is soft-deleted. A linked lead gets `Meeting removed: {title}.` Deleting again is `404`.

---

## Salespeople and account detail

### `GET /users/sales/:id`

Auth: admin, or a sales user requesting **their own** id (`403` for any other id). `404` if the id is not a sales user.

Same record as `GET /users/sales` items:

```json
{
  "id": "uuid",
  "firstName": "Amy",
  "lastName": "Alpha",
  "dateOfBirth": "1992-04-18",
  "email": "amy@example.com",
  "phone": "416-555-0108",
  "role": "SALES",
  "status": "active"
}
```

`dateOfBirth` may be `null`. `status` is `active` or `inactive`.

`GET /users/sales` is unchanged and still paginated (`body.data.data`).

### `GET /salespeople`

Auth: **admin only**. Query: `status` = `active` \| `inactive` \| `all` (default `all`).

`body.data` is an **array** (not paginated), ordered by last name, first name.

```json
{
  "id": "uuid",
  "firstName": "Priya",
  "lastName": "Nair",
  "email": "priya.nair@example.com",
  "phone": "416-555-0108",
  "status": "active",
  "inRoundRobin": true,
  "assignedLeadCount": 3
}
```

`inRoundRobin` is `status === "active"`. `assignedLeadCount` is leads that are not `Won` or `Lost`.

### `GET /salespeople/:id`

Auth: **admin only**. Query: `timeZoneOffset?` (affects `stats.overdue` and the `queues` on the embedded leads). `404` if the id is not a sales user.

```json
{
  "id": "uuid",
  "firstName": "Amy",
  "lastName": "Alpha",
  "email": "amy@example.com",
  "phone": "416-555-0108",
  "status": "active",
  "stats": { "open": 1, "won": 1, "lost": 0, "overdue": 1 },
  "currentLeads": [],
  "pastLeads": [],
  "events": [
    {
      "id": "uuid",
      "occurredAt": "2026-10-19T20:00:00.000Z",
      "kind": "Stage",
      "leadId": "uuid-or-null",
      "leadName": "Owen Brooks",
      "text": "Moved to Won."
    }
  ]
}
```

`currentLeads` are open stages. `pastLeads` are `Won` and `Lost`. Both use the lead list-item shape, including `queues`. `events` is newest first, at most 50. A meeting shows as `Call` or `Visit` when `meta.meetingKind` says so. Unmatched calls logged by that rep appear as `kind: "Call"` with `leadId: null` and `leadName` set to the caller name.

---

## Already live (do not rebuild)

| Method | Path |
|--------|------|
| `POST` | `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` |
| `GET` | `/sales/dashboard` (signed-in sales profile; sales role only) |
| `GET`, `POST` | `/users/sales` |
| `POST` | `/users/sales/:id/deactivate` |
| `POST` | `/users/sales/:id/password` |
| `POST` | `/users/sales/:id/sessions/revoke` |

Login already accepts `ADMIN` and `SALES`.
