# Sales Workspace Backend API Spec

**Audience:** Cursor (or any engineer) implementing these endpoints in the Senoria backend.

**Source of truth:** Senoria Admin web frontend (`Senoria Admin`). Sales **account** APIs already exist. Sales **workspace** screens (Today, Leads, Calls, Calendar, Salespeople) are UI previews on mock data and need these APIs.

**Out of scope for this document:** Meta, RingCentral, Zoho, and Outlook integrations. Build backend-owned CRUD first. Third-party wiring is listed at the end as a separate phase.

---

## How to use this document in Cursor

1. Open the **backend** project in Cursor.
2. Paste or attach this file.
3. Prompt example:

```text
Implement the Sales Workspace APIs from SALES_WORKSPACE_BACKEND_API_SPEC.md.
Follow existing Senoria /api/v1 conventions (envelope, camelCase, auth, pagination).
Do Phase 1 first. Do not implement third-party integrations yet.
Match the request/response shapes exactly so the admin web app can wire up next.
```

4. After each phase, verify routes against the checklist at the bottom.

---

## Existing conventions (must match)

| Rule | Value |
|------|--------|
| Base path | `/api/v1` |
| Auth | `Authorization: Bearer <accessToken>` |
| Client header (web) | `X-Client: senoria-admin-web/1.0.0` |
| Body / JSON | camelCase field names |
| Success envelope | `{ "success": true, "message": string, "data": ..., "timestamp"?: string, "requestId"?: string }` |
| List pagination | `data` = array; `meta` = `{ page, pageSize, total, totalPages, hasNextPage, hasPreviousPage }` (or equivalent already used by `/users/sales`) |
| Error envelope | Include both `message` / `error.message`, and `error.fields` / `errors` (map of string arrays) |
| Roles | `ADMIN`, `SALES` (and existing `CAREGIVER` elsewhere — not used here) |
| Timestamps | Prefer ISO 8601 UTC (`2026-11-20T14:30:00.000Z`). UI formats relative labels. |
| Dates for forms | `YYYY-MM-DD` |
| Times for forms | `HH:mm` (24h) |

Reuse the same auth middleware, sales-user model, and response helpers already used by:

- `GET/POST /users/sales`
- `POST /users/sales/:id/deactivate`
- `POST /users/sales/:id/password`
- `POST /users/sales/:id/sessions/revoke`
- `GET /sales/dashboard`

---

## Already implemented (do not rebuild)

These power `/sales`, `/sales/new`, `/sales/[id]`, and `/profile` for sales users.

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/users/sales` | Query: `page`, `pageSize`, `status` = `active` \| `inactive` \| `all` |
| `POST` | `/users/sales` | Body: `firstName`, `lastName`, `dateOfBirth`, `email`, `password`, `phone` |
| `POST` | `/users/sales/:id/deactivate` | Inactive cannot sign in; skip in round-robin |
| `POST` | `/users/sales/:id/password` | Ends current sign-in |
| `POST` | `/users/sales/:id/sessions/revoke` | Revoke without deactivating |
| `GET` | `/sales/dashboard` | Signed-in sales person’s own profile |
| Auth | `/auth/login`, `/auth/logout`, `/auth/refresh`, forgot/reset | Login already allows `ADMIN` and `SALES` |

**Small gap to fill when convenient:**

| Method | Path | Why |
|--------|------|-----|
| `GET` | `/users/sales/:id` | Admin detail page currently lists all pages then finds by id |

---

## Domain model

### Enums

```ts
type LeadStage = "New" | "Contacted" | "Qualified" | "Visit booked" | "Won" | "Lost";
type LeadSource = "Facebook" | "Instagram" | "Phone" | "Referral";
type QueueFilter = "new" | "due" | "overdue" | "mine";
type CallDirection = "Outbound" | "Inbound";
type CallResult = "Connected" | "No answer" | "Voicemail" | "Missed";
type NoteOutcome = "Connected" | "No answer" | "Voicemail" | "Booked";
type MeetingKind = "Call" | "Visit";
type TimelineKind = "Lead" | "Call" | "Note" | "Meeting" | "Stage" | "Assignment";
```

### Entities

**Lead**

| Field | Type | Notes |
|-------|------|--------|
| `id` | string (uuid) | |
| `firstName`, `lastName` | string | |
| `phone` | string | Required |
| `email` | string \| null | |
| `source` | LeadSource | |
| `stage` | LeadStage | Default `New` |
| `ownerId` | string \| null | Sales user id |
| `about` | string | Free text |
| `lastTouchAt` | ISO string \| null | Updated on note/call/stage/assign |
| `nextStep` | string \| null | Human-readable next action |
| `nextStepAt` | ISO string \| null | Due datetime for queue logic |
| `createdAt`, `updatedAt` | ISO string | |

**LeadTimelineEvent** (append-only)

| Field | Type |
|-------|------|
| `id` | string |
| `leadId` | string |
| `kind` | TimelineKind |
| `text` | string |
| `occurredAt` | ISO string |
| `actorId` | string \| null |
| `meta` | object \| null | Optional structured payload |

**Call**

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | |
| `leadId` | string \| null | Null = unmatched inbound |
| `ownerId` | string \| null | Sales user who owns/handled it |
| `name` | string | Display name (lead name or “Unknown caller”) |
| `phone` | string | |
| `direction` | CallDirection | |
| `startedAt` | ISO string | |
| `endedAt` | ISO string \| null | |
| `durationSeconds` | number \| null | |
| `result` | CallResult | |
| `recordingUrl` | string \| null | Filled later by telephony sync |
| `recordingAvailable` | boolean | `true` when Connected and recording exists |

**Meeting**

| Field | Type |
|-------|------|
| `id` | string |
| `leadId` | string \| null |
| `ownerId` | string |
| `title` | string |
| `person` | string | Display name |
| `kind` | MeetingKind |
| `startAt` | ISO string |
| `endAt` | ISO string |

**Round-robin state**

Track which active sales user receives the next new lead (e.g. last assigned index or last `ownerId`). Only users with sales role and `status === "active"` participate. Inactive users are skipped. Admin may still manually assign to an inactive user.

### Queue computation (server-side)

A lead may appear in multiple queues:

| Queue | Rule |
|-------|------|
| `new` | `stage === "New"` and not closed |
| `due` | `nextStepAt` is on the viewer’s “today” (use client `timeZoneOffset` or store TZ; document choice) and stage not `Won`/`Lost` |
| `overdue` | `nextStepAt` is before start of today and stage not `Won`/`Lost` |
| `mine` | `ownerId ===` current sales user (for admin listing “mine” of a selected rep, use `ownerId` query) |

Closed stages `Won` / `Lost` stay listable but should not inflate due/overdue counts unless product says otherwise. Prefer: exclude from `due` / `overdue`.

### Visibility

| Role | Leads | Calls | Meetings |
|------|-------|-------|----------|
| `SALES` | Only `ownerId === self` | Calls for owned leads **or** `leadId === null` (unmatched inbound) | Meetings where `ownerId === self` (or lead owned by self — pick one and stick to it; prefer `ownerId`) |
| `ADMIN` | All | All | All |

---

## Implementation phases

### Phase 1 — Leads + assignment + stage + notes (unblocks Today & Leads)

Priority order inside phase: list → detail → create → assign → stage → notes → queue summary → assignment state.

### Phase 2 — Calls

List, detail/recording metadata, create/log.

### Phase 3 — Meetings / calendar

List by range, create, update, delete.

### Phase 4 — Salespeople oversight + single-user GET

Aggregates for `/salespeople` and activity feed; `GET /users/sales/:id`.

### Phase 5 (later, separate) — Third-party integrations

Meta intake webhook, RingCentral dial/sync, Zoho note push, Outlook calendar push. **Do not block Phases 1–4 on these.**

---

## Phase 1 APIs

### 1. `GET /leads`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Query | `page` (default 1), `pageSize` (default 50, max 100), `stage?`, `ownerId?`, `queue?` (`new`\|`due`\|`overdue`\|`mine`), `search?` (name/phone/email), `timeZoneOffset?` (e.g. `+05:30`) for queue day boundaries |
| Scope | `SALES` forced to own leads; ignore foreign `ownerId` for sales unless equal to self |
| Success `data` | Array of lead list items |
| Success `meta` | Pagination |

**Lead list item shape:**

```json
{
  "id": "uuid",
  "firstName": "Maria",
  "lastName": "Chen",
  "phone": "416-555-0142",
  "email": "maria.chen@email.com",
  "source": "Facebook",
  "stage": "New",
  "ownerId": "sales-user-uuid",
  "ownerName": "Alex Morgan",
  "about": "Daughter asking about weekday morning care…",
  "lastTouchAt": "2026-11-20T13:02:00.000Z",
  "nextStep": "Intro call today at 9:30",
  "nextStepAt": "2026-11-20T14:30:00.000Z",
  "queues": ["new", "due", "mine"],
  "createdAt": "2026-11-20T13:00:00.000Z"
}
```

Include `queues` computed for the **requesting user** (so `mine` is meaningful).

---

### 2. `GET /leads/:id`

| | |
|--|--|
| Auth | `ADMIN` or owning `SALES` |
| Success `data` | Full lead + `timeline` |

```json
{
  "id": "uuid",
  "firstName": "Maria",
  "lastName": "Chen",
  "phone": "416-555-0142",
  "email": "maria.chen@email.com",
  "source": "Facebook",
  "stage": "New",
  "ownerId": "sales-user-uuid",
  "ownerName": "Alex Morgan",
  "about": "…",
  "lastTouchAt": "…",
  "nextStep": "…",
  "nextStepAt": "…",
  "queues": ["new", "due", "mine"],
  "createdAt": "…",
  "updatedAt": "…",
  "timeline": [
    {
      "id": "uuid",
      "kind": "Lead",
      "text": "Lead received from a Facebook lead ad.",
      "occurredAt": "2026-11-20T13:02:00.000Z"
    }
  ]
}
```

`404` if missing. `403` if sales user does not own the lead.

---

### 3. `POST /leads`

| | |
|--|--|
| Auth | `ADMIN` (and optionally system/service later). Sales may be allowed if product wants manual intake — default **ADMIN only** for v1 |
| Body | |

```json
{
  "firstName": "string",
  "lastName": "string",
  "phone": "string",
  "email": "string | optional",
  "source": "Facebook | Instagram | Phone | Referral",
  "about": "string | optional",
  "ownerId": "string | optional"
}
```

**Semantics:**

1. If `ownerId` omitted → assign via round-robin among **active** sales users.
2. If no active sales users → create with `ownerId: null` and timeline note, or reject with `422` — prefer create unassigned + timeline “No active sales executive for round-robin.”
3. Append timeline event `kind: "Lead"` (intake).
4. Append `kind: "Assignment"` when owner set.
5. Update round-robin cursor when auto-assigned.

**Success:** `201` with created lead (same shape as detail, timeline included).

---

### 4. `PATCH /leads/:id`

| | |
|--|--|
| Auth | `ADMIN` or owning `SALES` |
| Body (all optional) | `about`, `phone`, `email`, `nextStep`, `nextStepAt` |
| Note | Do **not** change `ownerId` or `stage` here if dedicated endpoints exist below (keeps audit clear). |

---

### 5. `PATCH /leads/:id/stage`

| | |
|--|--|
| Auth | `ADMIN` or owning `SALES` |
| Body | `{ "stage": "Contacted" }` |
| Semantics | Update stage; set `lastTouchAt`; append timeline `kind: "Stage"` e.g. `Moved to Contacted.` |
| Validate | Stage must be one of the enum values |

---

### 6. `POST /leads/:id/assign`

| | |
|--|--|
| Auth | **ADMIN only** |
| Body | `{ "ownerId": "sales-user-uuid" }` |
| Semantics | Reassign even if target is inactive; append timeline `kind: "Assignment"`; update `lastTouchAt` |
| Errors | `404` lead; `404`/`422` if owner not a sales user |

---

### 7. `POST /leads/:id/notes`

| | |
|--|--|
| Auth | `ADMIN` or owning `SALES` |
| Body | |

```json
{
  "outcome": "Connected | No answer | Voicemail | Booked",
  "text": "string",
  "followUpDate": "YYYY-MM-DD | optional",
  "followUpTime": "HH:mm | optional",
  "stage": "LeadStage | optional"
}
```

**Semantics:**

1. Append timeline `kind: "Note"` (include outcome in text or `meta`).
2. Update `lastTouchAt`.
3. If `followUpDate` (+ optional time) present:
   - Set `nextStepAt` from date/time (timezone: use request offset or server default; document it).
   - Set `nextStep` to a short phrase (e.g. `Follow-up call on 2026-11-21 at 10:00`).
   - Optionally create a `Meeting` with `kind: "Call"` (recommended so Calendar/Today sidebar stay consistent).
4. If `stage` provided, apply stage change + Stage timeline event (same as stage endpoint).
5. If `outcome === "Booked"` and no follow-up datetime, still allow; UI usually sends follow-up when booking.

**Success `data`:** updated lead detail (with timeline). If a meeting was created, include `meetingId` in `data` or return `{ lead, meeting }`.

---

### 8. `GET /leads/queues/summary`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Query | `timeZoneOffset?`, `ownerId?` (admin only; sales ignored / forced to self) |
| Success `data` | |

```json
{ "new": 2, "due": 3, "overdue": 1, "mine": 5 }
```

For `ADMIN` without `ownerId`, `mine` may mean “assigned to anyone” total open leads, or omit — prefer: require `ownerId` for admin `mine`, or define `mine` as count of leads owned by the authenticated user (admins who are not sales get `mine: 0`). Match frontend: sales uses self; admin sees all queues across all leads for `new`/`due`/`overdue`, and `mine` can be total non-closed owned by filter. Simplest v1: compute all four for the visible lead set (sales = owned; admin = all). For admin, `mine` = all non-closed leads (same as visible “mine” tab if admin sees every lead’s `mine` flag as true for owned-by-anyone). **Recommended v1:** for each lead, `queues` includes `mine` only when `ownerId === currentUser.id`. Admin summary `mine` = leads where admin is somehow owner (usually 0) **or** pass optional `ownerId`. Frontend Today for admin currently shows all leads in queues from mock flags — compute `new`/`due`/`overdue` globally for admin; for `mine` use optional `ownerId` query.

---

### 9. `GET /sales/assignment-state`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Success `data` | |

```json
{
  "activeRepIds": ["uuid1", "uuid2"],
  "nextOwnerId": "uuid1",
  "nextOwnerName": "Priya Nair"
}
```

Used for the Leads banner: “Next lead goes to X.”

---

## Phase 2 APIs — Calls

### 10. `GET /calls`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Query | `page`, `pageSize`, `from?` (ISO or `YYYY-MM-DD`), `to?`, `ownerId?`, `leadId?`, `result?`, `direction?` |
| Scope | Sales: `leadId` null **or** lead owned by self |
| Success `data` | |

```json
{
  "id": "uuid",
  "when": "2026-11-19T20:14:00.000Z",
  "leadId": "uuid-or-null",
  "name": "Priya Shah",
  "phone": "437-555-0164",
  "direction": "Outbound",
  "durationSeconds": 252,
  "durationLabel": "4 min 12 sec",
  "result": "Connected",
  "recordingAvailable": true,
  "ownerId": "uuid-or-null",
  "ownerName": "Alex Morgan"
}
```

`durationLabel` may be computed client-side; providing it is optional. Prefer `durationSeconds` + ISO `when` (`startedAt`).

Also support week summary either as:

- client aggregation from the list, or
- optional `GET /calls/summary?from&to` returning counts by result — nice-to-have.

---

### 11. `GET /calls/:id`

| | |
|--|--|
| Auth | Same visibility as list |
| Success `data` | Full call + `recordingUrl` (nullable) |

---

### 12. `POST /calls`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Body | |

```json
{
  "leadId": "uuid | null | omit",
  "phone": "string",
  "direction": "Outbound | Inbound",
  "startedAt": "ISO",
  "endedAt": "ISO | optional",
  "durationSeconds": "number | optional",
  "result": "Connected | No answer | Voicemail | Missed",
  "name": "string | optional"
}
```

**Semantics:**

1. If `leadId` set, verify access; default `name` from lead; set `ownerId` from lead owner (or actor).
2. Append lead timeline `kind: "Call"` when `leadId` present.
3. Update lead `lastTouchAt`.
4. `recordingAvailable` false unless later sync sets URL.

Click-to-call bridge (`POST /leads/:id/calls/start`) is **optional** and belongs with RingCentral (Phase 5). For Phase 2, manual `POST /calls` is enough for the Calls screen + logging after a preview dialer.

---

## Phase 3 APIs — Meetings

### 13. `GET /sales/meetings`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Query | **Required** `from` (`YYYY-MM-DD`), `to` (`YYYY-MM-DD`); optional `ownerId` (admin) |
| Scope | Sales: own meetings |
| Success `data` | |

```json
{
  "id": "uuid",
  "leadId": "uuid-or-null",
  "ownerId": "uuid",
  "title": "Home visit",
  "person": "Helen Wright",
  "kind": "Visit",
  "startAt": "2026-11-20T19:30:00.000Z",
  "endAt": "2026-11-20T20:30:00.000Z"
}
```

---

### 14. `POST /sales/meetings`

| | |
|--|--|
| Auth | `ADMIN` or `SALES` |
| Body | |

```json
{
  "leadId": "uuid",
  "title": "string",
  "kind": "Call | Visit",
  "startAt": "ISO",
  "endAt": "ISO"
}
```

Derive `person` from lead name. Set `ownerId` to lead’s owner (or actor if admin booking for a lead). Append timeline `kind: "Meeting"`. Optionally bump `nextStep` / `nextStepAt`.

---

### 15. `PATCH /sales/meetings/:id`

| | |
|--|--|
| Auth | Admin or meeting owner |
| Body | Partial: `title`, `kind`, `startAt`, `endAt`, `leadId` |

---

### 16. `DELETE /sales/meetings/:id`

| | |
|--|--|
| Auth | Admin or meeting owner |
| Semantics | Soft-delete or hard-delete; append timeline note if linked to lead (optional) |

---

## Phase 4 APIs — Salespeople + account detail

### 17. `GET /users/sales/:id`

| | |
|--|--|
| Auth | `ADMIN` (sales may only fetch self — or use `/sales/dashboard`) |
| Success `data` | Existing `SalesRecord` shape: `id`, `firstName`, `lastName`, `dateOfBirth`, `email`, `phone`, `role`, `status` |

---

### 18. `GET /salespeople`

Enrichment over sales users for the `/salespeople` admin table.

| | |
|--|--|
| Auth | `ADMIN` only |
| Query | `status?` = `active` \| `inactive` \| `all` |
| Success `data` | |

```json
{
  "id": "uuid",
  "firstName": "Priya",
  "lastName": "Nair",
  "email": "priya.nair@senoria.com",
  "phone": "416-555-0108",
  "status": "active",
  "inRoundRobin": true,
  "assignedLeadCount": 3
}
```

`inRoundRobin` ≡ `status === "active"`. `assignedLeadCount` = open leads (stage not `Won`/`Lost`) owned by that user.

Alternatively enrich `GET /users/sales` with these fields — either approach is fine; document which one the web app should call.

---

### 19. `GET /salespeople/:id`

| | |
|--|--|
| Auth | `ADMIN` only |
| Success `data` | |

```json
{
  "id": "uuid",
  "firstName": "…",
  "lastName": "…",
  "email": "…",
  "phone": "…",
  "status": "active",
  "stats": {
    "open": 4,
    "won": 1,
    "lost": 1,
    "overdue": 1
  },
  "currentLeads": [ /* lead list items, open stages */ ],
  "pastLeads": [ /* Won/Lost */ ],
  "events": [
    {
      "id": "uuid",
      "occurredAt": "ISO",
      "kind": "Assignment | Call | Visit | Stage | Note | Meeting",
      "leadId": "uuid-or-null",
      "leadName": "Maria Chen",
      "text": "…"
    }
  ]
}
```

`events` = recent activity for that rep (from timeline + calls), newest first, limit ~50.

---

## Optional composite (nice-to-have)

### `GET /sales/today`

| Query | `queue`, `leadId?`, `date?` (`YYYY-MM-DD`), `timeZoneOffset?` |
| Success | `{ queue: Lead[], selectedLead: LeadDetail | null, meetings: Meeting[], queueSummary: {...} }` |

Not required if Phase 1–3 endpoints exist; frontend can compose.

---

## Validation & error codes

| Situation | Status |
|-----------|--------|
| Validation (bad stage, missing phone, bad date) | `422` with field errors |
| Unauthenticated | `401` |
| Authenticated but wrong role / not owner | `403` |
| Unknown id | `404` |
| Conflict (optional) | `409` |

Password and auth rules remain as today (min password length already used by sales create).

---

## Suggested database tables

Minimal relational sketch (adapt to existing ORM):

1. `leads`
2. `lead_timeline_events`
3. `sales_calls` (avoid clash with other `calls` if any)
4. `sales_meetings`
5. `sales_round_robin_state` (single row: `last_assigned_sales_user_id` or `cursor`)

Indexes: `leads(owner_id, stage)`, `leads(next_step_at)`, `sales_calls(lead_id)`, `sales_calls(started_at)`, `sales_meetings(owner_id, start_at)`, `lead_timeline_events(lead_id, occurred_at)`.

Foreign keys: `owner_id` → users (sales). Soft-delete optional.

---

## Seed / fixture guidance

For local testing, seed 3–4 active sales users + 1 inactive, ~8 leads across stages/sources/queues, a few calls (including one unmatched inbound), and meetings spanning the current week. Mirror the frontend mock in `src/lib/sales-portal.ts` if useful.

---

## Frontend screens that consume these APIs

| Screen | Path | Needs |
|--------|------|--------|
| Today | `/today` | Leads by queue, lead detail, stage, assign (admin), notes, today’s meetings, dialer → later calls |
| Leads | `/leads` | Lead list, assign, assignment-state banner |
| Calls | `/calls` | Call list (+ summary) |
| Calendar | `/calendar` | Meetings by range |
| Salespeople | `/salespeople`, `/salespeople/:id` | Phase 4 |
| Sales accounts | `/sales`, `/sales/new`, `/sales/:id` | Already live; add `GET /users/sales/:id` |

---

## Acceptance checklist

### Phase 1

- [ ] `GET /leads` paginated + filters + role scoping
- [ ] `GET /leads/:id` with timeline
- [ ] `POST /leads` with round-robin when `ownerId` omitted
- [ ] `PATCH /leads/:id`
- [ ] `PATCH /leads/:id/stage` writes timeline
- [ ] `POST /leads/:id/assign` admin-only
- [ ] `POST /leads/:id/notes` updates touch + optional follow-up/meeting
- [ ] `GET /leads/queues/summary`
- [ ] `GET /sales/assignment-state`
- [ ] Inactive sales users skipped by round-robin
- [ ] Sales cannot see other owners’ leads

### Phase 2

- [ ] `GET /calls` with unmatched inbound visible to sales
- [ ] `GET /calls/:id`
- [ ] `POST /calls` appends lead timeline when linked

### Phase 3

- [ ] `GET /sales/meetings?from&to`
- [ ] `POST` / `PATCH` / `DELETE` meetings

### Phase 4

- [ ] `GET /users/sales/:id`
- [ ] `GET /salespeople` with counts
- [ ] `GET /salespeople/:id` with stats + events

---

## Third-party integrations (separate list — implement later)

Do **not** implement these in the same PR as Phases 1–4 unless explicitly asked.

| Integration | Backend work | Depends on |
|-------------|--------------|------------|
| **Meta Lead Ads** | Webhook `POST /webhooks/meta/leads` → map form → `POST /leads` internals + round-robin | Phase 1 create + assign |
| **RingCentral** | Click-to-call start, call CDR webhook → `POST /calls`, recording URLs | Phase 2 |
| **Zoho CRM** | On note save, push note/activity to Zoho; store external ids | Phase 1 notes |
| **Outlook** | `POST /leads/:id/calendar/outlook` or meeting sync via Microsoft Graph | Phase 3 |

UI copy today: “Nothing here is saved, dialed, or sent to Zoho, Meta, RingCentral, or Outlook.” Core APIs remove the “not saved” part; dialing/CRM/calendar push remain Phase 5.

---

## Non-goals

- Do not reuse caregiver `/appointments` or `/schedule` for sales meetings.
- Do not require Zoho/Meta/RingCentral credentials to ship Phases 1–4.
- Do not change existing sales account create/deactivate/password/session contracts unless fixing bugs.
- Do not return relative time strings (`Today 9:30`) from the API.

---

## Reference — frontend mock enums & behaviors

File: `Senoria Admin/src/lib/sales-portal.ts` (mock only).

- Stages: `New` → `Contacted` → `Qualified` → `Visit booked` → `Won` | `Lost`
- Sources: `Facebook`, `Instagram`, `Phone`, `Referral`
- Note outcomes on Today: `Connected`, `No answer`, `Voicemail`, `Booked`
- Call results: `Connected`, `No answer`, `Voicemail`, `Missed`
- Meeting kinds: `Call`, `Visit`

End of spec.
