# Sales integrations

Flags default off and secrets stay empty. Leads, notes, calls, meetings, and salespeople keep working while an integration is disabled.

Meta lead ads receives webhooks. Zoho CRM can send leads in through a workflow webhook, and it receives a lead and a note after a Senoria note is saved. RingCentral places an outbound call when a salesperson starts one, and a call-log webhook records the result. Outlook writes one event on a mailbox calendar after a sales meeting is saved. A disabled integration does no vendor work. `ZOHO_OUTBOUND_ENABLED` does not push leads.

## Flags

Set a flag to the string `true` to request that integration. Any other value, including empty, leaves it off.

| Flag | Vendor |
| --- | --- |
| `META_LEADS_ENABLED` | Meta lead ads |
| `RINGCENTRAL_ENABLED` | RingCentral |
| `ZOHO_ENABLED` | Zoho note push |
| `ZOHO_INBOUND_ENABLED` | Zoho lead webhook |
| `ZOHO_OUTBOUND_ENABLED` | Reserved Senoria lead push. Off by default, and a no-op. |
| `OUTLOOK_ENABLED` | Outlook |

## Credentials

Secrets come from the environment. `.env.example` lists empty placeholders. Do not commit real values.

`configured` is true only when every required variable for that vendor is non-empty. Optional variables do not affect `configured`.

| Vendor | Required | Optional |
| --- | --- | --- |
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN` | `META_GRAPH_API_VERSION`, `META_LEAD_FIELD_MAP`, `META_LEAD_FIELD_MAP_FILE` |
| RingCentral | `RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_SERVER_URL`, `RINGCENTRAL_JWT`, `RINGCENTRAL_ACCOUNT_ID`, `RINGCENTRAL_EXTENSION_ID`, `RINGCENTRAL_FROM_NUMBER` | `RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` |
| Zoho | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_DOMAIN`, `ZOHO_API_DOMAIN` | `ZOHO_CRM_MODULE` (`Leads` or `Contacts`, default `Leads`), `ZOHO_WEBHOOK_SECRET`, `ZOHO_LEAD_MAP`, `ZOHO_LEAD_MAP_FILE` |
| Outlook | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID`, `OUTLOOK_CALENDAR_USER` | none |

Outlook accepts the same names with a `MICROSOFT_` prefix. `OUTLOOK_CLIENT_ID` and `MICROSOFT_CLIENT_ID` are the client id, and the same pairing applies to `CLIENT_SECRET`, `TENANT_ID`, and `CALENDAR_USER`. For each name, the `OUTLOOK_` value is used when it is non-empty. The `MICROSOFT_` value is used only when the `OUTLOOK_` value is empty. `MICROSOFT_ENABLED` is read only when `OUTLOOK_ENABLED` is empty. `OUTLOOK_CALENDAR_USER` is the mailbox user principal name, such as `calendar@senoria.com`.

`enabled` in the status payload is true only when the flag is `true` and the vendor is configured. A flag set without credentials is treated as disabled, and the process logs one warning for that vendor until the credentials are present or the flag is turned off.

Meta uses those values as follows:

- `META_APP_ID` must be set for `configured`. It identifies the Meta app.
- `META_APP_SECRET` is the key for `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, prefixed with `sha256=`). The same secret builds `appsecret_proof` on the lead lookup.
- `META_WEBHOOK_VERIFY_TOKEN` must equal `hub.verify_token` on the challenge request.
- `META_PAGE_ACCESS_TOKEN` is sent as a bearer token to Graph when the webhook only contains `leadgen_id`. It is not logged.
- `META_PAGE_ID` must match `page_id` on the leadgen value when both are present. A mismatch is ignored.
- `META_GRAPH_API_VERSION` defaults to `v23.0` when empty or not shaped like `v23.0`.

## Status

`GET /api/v1/integrations/status`

Auth: `ADMIN` or `SALES`.

```json
{
  "meta": { "enabled": false, "configured": false },
  "ringcentral": { "enabled": false, "configured": false },
  "zoho": { "enabled": false, "configured": false },
  "outlook": { "enabled": false, "configured": false }
}
```

The body is wrapped in the usual `{ success, message, data, timestamp, requestId }` envelope. `data` is the object above.

`zoho.enabled` follows `ZOHO_ENABLED` and the five OAuth values. That flag is the note push. `ZOHO_INBOUND_ENABLED` is separate and is not a field on this payload. Inbound lead creation can run while `zoho.enabled` is false. `ZOHO_OUTBOUND_ENABLED` is also separate. Setting it does not push leads.

## Meta lead ads webhook

Public URL, no access token:

- `GET /api/v1/webhooks/meta/leads`
- `POST /api/v1/webhooks/meta/leads`

In the Meta app, subscribe the Page to the `leadgen` field and set the callback URL to the GET/POST path above. The verify token in Meta must be the same string as `META_WEBHOOK_VERIFY_TOKEN`.

### Challenge

`GET` with `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge`.

When the verify token matches, the response is `200` and the body is the challenge string (`text/plain`). This works while `META_LEADS_ENABLED` is still false, so Meta can confirm the URL before lead creation is turned on. Any other combination is `403`.

### Signature policy

`POST` reads the raw JSON body and the `X-Hub-Signature-256` header.

- When `META_APP_SECRET` is set, the signature must match. A missing or wrong signature is `403`. No lead is created.
- When the signature matches and Meta is disabled or not configured, the response is `200` with `{ "received": true, "results": [] }`. No lead is created and Graph is not called.
- When `META_APP_SECRET` is empty and `NODE_ENV` is `production`, the post is `403`.
- When `META_APP_SECRET` is empty and `NODE_ENV` is not `production`, the post is `200` and is ignored. Unsigned posts never create leads.

A valid, enabled post returns `200`:

```json
{
  "received": true,
  "results": [
    { "leadgenId": "444555666777", "leadId": "…", "created": true }
  ]
}
```

A Graph lookup failure returns `500` so Meta retries. A payload that is not a page `leadgen` event, a page id mismatch, or a lead with no usable name and phone returns `200` and does not create a lead.

### What a valid post does

1. Read each `leadgen_id` from `entry[].changes[]` where `field` is `leadgen`.
2. If a lead already has `externalSource=meta` and `externalId` equal to that id, return that lead and do not create another. Graph is not called.
3. If the webhook value has no `field_data`, `GET https://graph.facebook.com/{version}/{leadgen_id}` with the page access token and `fields=id,created_time,field_data,platform`.
4. Map fields, then call the existing lead create path with no owner so round-robin assigns an active salesperson.
5. Store `externalSource=meta`, `externalId` as the Meta lead id, and `lastSyncedAt`. The timeline is the usual lead-ad line plus the assignment line. `source` is `Instagram` when the platform is `ig` or `instagram`, otherwise `Facebook`.

### Field map

The default aliases are in `config/meta-lead-field-map.example.json`:

| Lead column | Meta field names, first match wins |
| --- | --- |
| first name | `first_name`, `first name` |
| last name | `last_name`, `last name` |
| full name | `full_name`, `full name`, `name` |
| email | `email`, `email_address` |
| phone | `phone_number`, `phone`, `mobile` |
| platform | `platform` |

`full_name` is split on whitespace when first and last are absent. A single name is used for both. Phone is required. Email may be empty.

Override the map with either:

- `META_LEAD_FIELD_MAP` — a JSON object. Listed keys replace the default aliases for those keys only.
- `META_LEAD_FIELD_MAP_FILE` — a path to a JSON file, used only when `META_LEAD_FIELD_MAP` is empty.

Example, if the form calls the phone question `mobile_phone`:

```json
{"phone":["mobile_phone","phone_number"]}
```

An invalid JSON value is ignored and the default map is used.

## RingCentral

Click-to-call and call logging. `POST /api/v1/calls` is unchanged: it logs a call and does not dial. RingCentral secrets are not returned to clients. The status payload stays `{ enabled, configured }`.

### Server auth

The API uses RingCentral's JWT bearer grant. There is no browser login and no stored refresh token. Create a JWT credential on the RingCentral app and put it in `RINGCENTRAL_JWT`.

When a call is started, or a recording is fetched, the API posts to `{RINGCENTRAL_SERVER_URL}/restapi/oauth/token` with HTTP Basic auth (`CLIENT_ID` and `CLIENT_SECRET`) and this body:

- `grant_type` = `urn:ietf:params:oauth:grant-type:jwt-bearer`
- `assertion` = `RINGCENTRAL_JWT`

The access token is cached in memory until one minute before `expires_in`. It is not logged and not sent to the sales client.

`RINGCENTRAL_SERVER_URL` is an https origin, `https://platform.ringcentral.com` or `https://platform.devtest.ringcentral.com`. A user, password, query, or path on that URL is rejected and RingCentral is not called.

`RINGCENTRAL_ACCOUNT_ID` and `RINGCENTRAL_EXTENSION_ID` are the RingOut path. `~` means the account or extension that owns the JWT. `RINGCENTRAL_FROM_NUMBER` is the number RingOut calls first (the desk or mobile that should ring). A 10-digit number is sent as `+1`. A number that already starts with `+` keeps its country code.

`RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` does not affect `configured`. Set it to the subscription's verification token. Production rejects the webhook when it is empty.

`enabled` is true only when `RINGCENTRAL_ENABLED=true` and every required variable above is non-empty. A flag without those values is disabled, RingCentral is not called, and the process logs one warning.

### Start a call

`POST /api/v1/leads/:id/calls/start`

Auth: `ADMIN`, or the `SALES` user who owns the lead. Another salesperson receives `403`. A missing lead is `404`. No request body.

The response uses the usual `{ success, message, data, timestamp, requestId }` envelope.

When RingCentral is not enabled, the status is **200**. RingCentral is not called and no call row is written:

```json
{
  "started": false,
  "reason": "ringcentral_not_configured"
}
```

That object is `data`. `success` is true. Dialing is off; the lead request itself succeeded.

When RingCentral is enabled, the API places a RingOut call:

`POST /restapi/v1.0/account/{accountId}/extension/{extensionId}/ring-out`

`from.phoneNumber` is `RINGCENTRAL_FROM_NUMBER`. `to.phoneNumber` is the lead phone. `playPrompt` is false. Each request waits at most 10 seconds.

```json
{
  "started": true,
  "callId": "255",
  "sessionId": "255",
  "status": "started"
}
```

`callId` and `sessionId` are the RingOut id from RingCentral. This request does not create a `sales_calls` row. The call-log webhook does that when the call ends. If RingCentral rejects the dial, the response is `502` with code `RINGCENTRAL_UNAVAILABLE` and message `RingCentral did not start the call.` The body does not include the vendor payload or any secret.

### Call-log webhook

Public URL, no access token:

`POST /api/v1/webhooks/ringcentral/calls`

In RingCentral, create a webhook subscription whose event filter is `/restapi/v1.0/account/~/extension/~/call-log` (or the same path with the account and extension ids). Deliver notifications to the URL above. This is the call-log record (the CDR), not a telephony-session progress event. A session event without a call-log `direction` and `startTime` is acknowledged and not stored.

#### Handshake

If the request has a `Validation-Token` header, the response is `200` with an empty body and the same `Validation-Token` header. Nothing is written. The handshake still requires the verification check below, and it works while RingCentral is disabled.

#### Verification

- When `RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` is set, the `Verification-Token` header must match. A missing or wrong token is `403` and nothing is written.
- When the token is empty and `NODE_ENV` is `production`, the post is `403`.
- When the token is empty and `NODE_ENV` is not `production`, the post is accepted so tests can run. Do not leave the token empty in production.

When the post is accepted and RingCentral is disabled, the response is `200`:

```json
{ "received": true, "results": [] }
```

No call is written and RingCentral is not called.

#### What an enabled post does

The body is a RingCentral notification. `body` may be one call-log object or an array of them. Each `type: Voice` record is logged. Any other `type` (SMS, Fax) is skipped. A record with no id, direction, `startTime`, or party phone is skipped. The response is still `200`. A database error is `500` so RingCentral retries.

The webhook body is not the success envelope:

```json
{
  "received": true,
  "results": [
    { "externalId": "s-a1b2", "callId": "…", "leadId": "… or null", "created": true }
  ]
}
```

Idempotency uses `externalSource=ringcentral` and `externalId`. The id is `telephonySessionId`, then `sessionId`, then the call-log `id`. A second delivery of the same id does not create another call and does not append another timeline row. `created` is false and `callId` is the existing row. If that row already has a recording URL, RingCentral is not called. If the first row had no recording URL and a later delivery has one, that URL is stored.

The other party's number is the outbound `to` number, or the inbound `from` number. It is matched to a lead by digits. A number with 10 or more digits matches the last 10, so `+1 416-555-0142` matches a lead stored as `416-555-0142`. If several leads match, the most recently updated one is used. If none match, `leadId` is null. That row is visible to every salesperson, the same rule as a manual call with no lead. The name is the lead's name, otherwise the party name on the record, otherwise `Unknown caller`. The owner is the lead's owner, or null when unmatched.

| RingCentral `result` | Stored `result` |
| --- | --- |
| Call connected, Accepted, Connected | Connected |
| Voicemail, Reply, Sent to Voicemail | Voicemail |
| Missed, Missed Call | Missed |
| No Answer, Busy, Rejected, Declined, Call Failed | No answer |
| Hang Up | Connected when duration is greater than zero, otherwise No answer |
| anything else | Connected when duration is greater than zero, otherwise No answer |

`duration` is seconds (`durationMs` is used when `duration` is absent). `startedAt` is `startTime`. `endedAt` is the start plus the duration when a duration is present. Direction is `Outbound` or `Inbound`.

When `leadId` is set, the lead's `lastTouchAt` is updated and a timeline row is appended: `{direction} call, {result}.` The lead's own `externalSource` is not changed.

### Recordings

When the stored result is Connected and the call-log record has `recording.id`, the API fetches:

`GET /restapi/v1.0/account/{accountId}/recording/{recordingId}`

and stores `contentUri` as `recordingUrl`. `GET /calls/:id` already sets `recordingAvailable` true when the result is Connected and `recordingUrl` is set.

If that metadata request fails, the call row is still saved. A `contentUri` already on the call-log record is kept when metadata does not return one. If there is still no URL, `recordingUrl` stays null and `syncError` is `RingCentral recording metadata request failed` (with the HTTP status when RingCentral returned one). A later delivery of the same session id can fill the URL. It does not add a second timeline row.

The stored URL is RingCentral's content address. It is returned only on `GET /calls/:id` to someone who can already see that call. It is not a public file. Client secrets are not included.

## Zoho CRM

Creating a Senoria lead does not call Zoho. Saving a note does, when `ZOHO_ENABLED=true`. The note API responds as soon as the Senoria note is stored. The Zoho push runs afterward. A Zoho error does not change the HTTP status of the note.

Leads that start in Zoho come in through the webhook in the next section. That path uses `ZOHO_INBOUND_ENABLED`. It does not use `ZOHO_ENABLED`.

### OAuth setup

Senoria Senior Health & Living Inc. is the Canada CRM Plus org `org110003644353`.

1. In the Zoho API console for the Canada data center, create a Server-based client.
2. Grant the client CRM scopes that can write the chosen module and notes, such as `ZohoCRM.modules.leads.ALL` and `ZohoCRM.modules.notes.ALL` (or `ZohoCRM.modules.ALL`). Use the contacts scope instead of leads when `ZOHO_CRM_MODULE=Contacts`. Read scope is enough for an id-only inbound fetch. Write scope is for the note push.
3. Complete the OAuth code grant once and keep the refresh token. Put that value in `ZOHO_REFRESH_TOKEN`. Do not commit it.
4. Set `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` from the same client.
5. Set `ZOHO_ACCOUNTS_DOMAIN=accounts.zohocloud.ca`. A leading `https://` is optional. Other data centers use their own accounts host (`accounts.zoho.com`, `accounts.zoho.eu`, `accounts.zoho.in`, and so on).
6. Set `ZOHO_API_DOMAIN=www.zohoapis.ca`. Other data centers use the matching API host (`www.zohoapis.com`, `www.zohoapis.eu`, and so on).
7. Set `ZOHO_ENABLED=true` only after those five values are non-empty and you want note push. Until then the status endpoint reports Zoho disabled and the note push sends no request.

The API exchanges the refresh token at `https://accounts.zohocloud.ca/oauth/v2/token` and caches the access token until one minute before `expires_in`. The access token is sent as `Authorization: Zoho-oauthtoken …` and is not written to logs.

Placeholder OAuth values are safe to leave in the environment while the client is provisioned. Values that contain `dummy`, `changeme`, `placeholder`, or `replace-me`, and values shorter than 16 characters, are treated as stand-ins. The process still boots. A webhook body that already contains the lead fields does not call Zoho. An id-only body calls Zoho only when the client id, secret, refresh token, and both domains look real.

### What is pushed

`ZOHO_CRM_MODULE` chooses the CRM module. `Leads` is the default. `Contacts` is the other accepted value. Anything else is treated as `Leads`.

| Senoria | Zoho Leads | Zoho Contacts |
| --- | --- | --- |
| first name | `First_Name` | `First_Name` |
| last name | `Last_Name` | `Last_Name` |
| phone | `Phone` | `Phone` |
| email, when present | `Email` | `Email` |
| source | `Lead_Source` | not sent |
| about, plus the Senoria lead id | `Description` | `Description` |
| constant `Senoria` | `Company` | not sent |

The note's outcome becomes `Note_Title`. The note text becomes `Note_Content`. The note is linked with `Parent_Id` and `se_module` set to the Zoho record and module.

The first push upserts by `Phone` when the Senoria lead has no Zoho id yet. Later pushes send the stored Zoho id so the same CRM record is updated. A note that already has a Zoho id is updated with `PUT` instead of inserted again.

Ids are stored as follows:

- The lead's `zohoRecordId` is the CRM lead or contact id. A Meta `externalSource` / `externalId` on that lead is not replaced. A lead with no external source also gets `externalSource=zoho` and `externalId` set to the same CRM id.
- The note timeline row gets `externalSource=zoho`, `externalId` as the CRM note id, and `lastSyncedAt`.

### Failure behavior

The Senoria note, its text, and the HTTP response stay as they were. The timeline row's `syncError` is a short status message such as `Zoho request failed with status 500`. The lead's `syncError` gets the same message. `zohoRecordId` is kept when the CRM record was created before the note call failed. Nothing is retried automatically. Saving another note runs a new push and reuses the stored Zoho lead id.

## Zoho inbound leads

Zoho is the source. Senoria receives leads. Senoria does not push lead creates or edits back to Zoho. `ZOHO_OUTBOUND_ENABLED` defaults off. The reserved outbound call returns without contacting Zoho, including when the flag is set to `true`. The Zoho lead owner is ignored. A new Senoria lead is assigned by the existing sales round-robin. An update does not change that owner.

### Webhook

Public URL, no bearer token:

`POST /api/v1/webhooks/zoho/leads`

Production shape:

`POST https://<api-host>/api/v1/webhooks/zoho/leads`

Header: `X-Zoho-Webhook-Secret`. The value must match `ZOHO_WEBHOOK_SECRET`. The comparison is constant-time. A missing header, a wrong value, or an empty `ZOHO_WEBHOOK_SECRET` is `403` with `{ "received": false }`. No lead is created. The secret is checked while `ZOHO_INBOUND_ENABLED` is still false, so a bad caller is rejected before the flag is turned on.

When the secret matches and `ZOHO_INBOUND_ENABLED` is not the string `true`, the response is `200`:

```json
{ "received": true, "results": [] }
```

No lead is created and Zoho is not called.

When the secret matches and inbound is on, the response is `200` for an accepted body, a duplicate, and a body that cannot be turned into a lead. Failures are logged. The HTTP status stays `200` so Zoho does not retry the same delivery in a loop.

```json
{
  "received": true,
  "results": [
    { "externalId": "82810000000332025", "leadId": "…", "created": true }
  ]
}
```

`externalId` is the CRM id with a leading `zcrm_` removed. `zcrm_82810000000332025` and `82810000000332025` are the same lead. Send the id as a JSON string. A 17-digit JSON number loses precision.

### Workflow in Zoho

In the Canada org (Setup gear → Automation → Workflow Rules):

1. Create a rule on the **Leads** module. Name it `Senoria lead sync`.
2. When: record action **Create or Edit**. If the screen allows only one trigger, create two rules, one for Create and one for Edit on any field.
3. Condition: all leads. Do not filter on the Zoho owner. Senoria ignores that owner.
4. Instant action: **Webhook**.
5. Method `POST`. URL `https://<api-host>/api/v1/webhooks/zoho/leads`.
6. Add a header named `X-Zoho-Webhook-Secret`. The value is the same string as `ZOHO_WEBHOOK_SECRET`. Do not put the secret in the URL.
7. Send the lead fields below. A standard Zoho webhook sends them as form fields (`application/x-www-form-urlencoded`). A JSON body (`Content-Type: application/json`) with the same names is also accepted. Either shape is enough. Include the fields on the body so Senoria does not have to call Zoho.
8. Save the rule and activate it.

| Parameter | Zoho field |
| --- | --- |
| `id` or `Record Id` | Lead Id |
| `First_Name` or `First Name` | First Name |
| `Last_Name` or `Last Name` | Last Name |
| `Email` | Email |
| `Phone` | Phone |
| `Mobile` | Mobile |
| `Description` | Description |
| `Lead_Source` or `Lead Source` | Lead Source |
| `Lead_Status` or `Lead Status` | Lead Status |

Names are matched without case, spaces, or underscores getting in the way. `Phone` is used when it is non-empty. `Mobile` is used when `Phone` is empty. The Zoho owner is not read.

Example JSON body (Amit Bishnoi sample, also stored at `tests/fixtures/zoho/amit-bishnoi.json`):

```json
{
  "id": "zcrm_82810000000332025",
  "First_Name": "Amit",
  "Last_Name": "Bishnoi",
  "Email": "amit@sample.com",
  "Phone": "9876543210",
  "Mobile": "",
  "Lead_Source": "Cold Call",
  "Lead_Status": "Contact in Future",
  "Description": "testing notes"
}
```

That sample becomes one Senoria lead: Amit Bishnoi, `amit@sample.com`, phone `9876543210`, source `Phone`, stage `Contacted`, about `testing notes`, `externalSource=zoho`, `externalId=82810000000332025`. Round-robin assigns an active salesperson. The timeline records `Lead received from Zoho.` A second delivery of the same body does not create another lead and does not add another timeline row.

A body that is only an id is loaded with `GET https://www.zohoapis.ca/crm/v2/Leads/{id}` when the OAuth values look real. Placeholder OAuth skips that call and creates no lead. A body that already has the fields above does not call Zoho.

### What is stored

Lookup order:

1. `externalSource=zoho` and `externalId`, or `zohoRecordId`, after the `zcrm_` prefix is removed.
2. An existing lead with the same phone (digits, last 10 when both numbers are at least 10 digits) or the same email. That lead is linked. A lead that already points at a different Zoho id is left alone, and a second lead is not created.
3. Otherwise `createLead` with no owner, so round-robin assigns the next active salesperson.

A lead that already has another `externalSource` (for example Meta) keeps that pair. The Zoho id is stored on `zohoRecordId`. A lead with no external source gets `externalSource=zoho` and `externalId`. `lastSyncedAt` is set and `syncError` is cleared on success. A write failure sets `syncError` and is logged. The webhook still returns `200`.

An update writes `Updated from Zoho.` on the timeline when a field changes. The timeline `meta` is `{ "origin": "zoho", "direction": "inbound", ... }`. That marker is the loop guard for a future outbound push: a lead just written from Zoho is not pushed back. `enqueueZohoLeadOutbound` is called after the write and returns without an HTTP call.

### Field maps

`config/zoho-lead-map.json` is the map, read from the process working directory. `ZOHO_LEAD_MAP` is a JSON object that overrides it. `ZOHO_LEAD_MAP_FILE` points at a different file. A missing or invalid file falls back to the same map compiled into the API. The process still boots.

Unknown `Lead_Source` values become `Referral`. Unknown `Lead_Status` values become `New`. The raw Zoho value is stored on the lead as `Zoho Lead_Source: …` or `Zoho Lead_Status: …` in `about`, and on the timeline `meta`. A value that is in the map is not copied into `about`.

| Zoho `Lead_Source` | Senoria `source` |
| --- | --- |
| Facebook | Facebook |
| X (Twitter) | Instagram |
| Cold Call, Chat, Sales Email Alias | Phone |
| Employee Referral, External Referral, Partner, Seminar Partner, Internal Seminar, Trade Show, Advertisement, Online Store, Public Relations, Web Download, Web Research | Referral |
| anything else | Referral, and the raw value is stored |

| Zoho `Lead_Status` | Senoria `stage` |
| --- | --- |
| Not Contacted | New |
| Attempted to Contact, Contact in Future, Contacted | Contacted |
| Pre-Qualified | Qualified |
| Not Qualified, Junk Lead, Lost Lead | Lost |
| anything else | New, and the raw value is stored |

A missing source or status on an update leaves the stored Senoria value as it was. On create, a missing source uses `Referral` and a missing status uses `New`, without a raw line.

### AWS

The API is already deployed. Zoho's workflow caller must reach it on the public internet.

- The load balancer or CloudFront listener is HTTPS on port 443. The certificate is in ACM and covers `<api-host>`.
- The load balancer security group allows inbound 443 from the internet. The instance or task security group allows 443 from the load balancer. Zoho does not publish a stable IP list for workflow webhooks, so do not lock 443 to a Zoho address.
- If AWS WAF is attached, allow `POST /api/v1/webhooks/zoho/leads` ahead of bot or geo rules that would drop Zoho.
- Store `ZOHO_WEBHOOK_SECRET`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and `ZOHO_REFRESH_TOKEN` in SSM Parameter Store as SecureString, or in Secrets Manager, and inject them into the task environment. Do not commit them and do not put them in the webhook URL.
- Set `ZOHO_ACCOUNTS_DOMAIN=accounts.zohocloud.ca` and `ZOHO_API_DOMAIN=www.zohoapis.ca`.
- Leave `ZOHO_OUTBOUND_ENABLED` unset or `false`.
- Set `ZOHO_INBOUND_ENABLED=true` only after the curl below returns `200`. Until then a correct secret returns `200` and `results` is empty.

### Curl after deploy

Wrong secret (no lead, `403`):

```bash
curl -sS -D - -o /tmp/zoho-webhook-body.json -X POST \
  "https://<api-host>/api/v1/webhooks/zoho/leads" \
  -H "Content-Type: application/json" \
  -H "X-Zoho-Webhook-Secret: not-the-secret" \
  -d '{"id":"zcrm_82810000000332025"}'
```

Accepted secret. With inbound still off, `results` is `[]` and no lead is created. With inbound on, this creates or updates the Amit sample. Run it a second time and confirm there is still one lead.

```bash
curl -sS -D - -o /tmp/zoho-webhook-body.json -X POST \
  "https://<api-host>/api/v1/webhooks/zoho/leads" \
  -H "Content-Type: application/json" \
  -H "X-Zoho-Webhook-Secret: $ZOHO_WEBHOOK_SECRET" \
  -d '{"id":"zcrm_82810000000332025","First_Name":"Amit","Last_Name":"Bishnoi","Email":"amit@sample.com","Phone":"9876543210","Lead_Source":"Cold Call","Lead_Status":"Contact in Future","Description":"testing notes"}'
```

### Outbound is deferred

`ZOHO_OUTBOUND_ENABLED` defaults off. Lead create and edit in Senoria are not sent to Zoho. The function reserved for that push returns immediately and does not call Zoho when the flag is off, and it still does not call Zoho when the flag is on, because the push is not built. An inbound write marks the lead so a future push can skip that same change and avoid a loop. Note push stays on `ZOHO_ENABLED` and is unchanged.

## Outlook calendar

Sales meetings are copied to one Microsoft 365 mailbox. The API uses the client-credentials (app-only) flow. There is no user sign-in and no redirect URI. A development tenant is optional. The test suite mocks Graph and does not call Microsoft.

### App registration

1. In the Microsoft Entra admin center, open **App registrations** and register a new app. Choose **Accounts in this organizational directory only**. Leave the redirect URI empty.
2. Copy the **Application (client) ID** to `OUTLOOK_CLIENT_ID` (or `MICROSOFT_CLIENT_ID`).
3. Copy the **Directory (tenant) ID** to `OUTLOOK_TENANT_ID` (or `MICROSOFT_TENANT_ID`). A tenant DNS name such as `senoria.onmicrosoft.com` is also accepted. `common` is not, because app-only tokens need a specific tenant.
4. Under **Certificates & secrets**, create a client secret. Copy the secret value once into `OUTLOOK_CLIENT_SECRET` (or `MICROSOFT_CLIENT_SECRET`). Do not commit it.
5. Under **API permissions**, add Microsoft Graph **application** permission `Calendars.ReadWrite`. This is not the delegated permission of the same name. Grant admin consent for the tenant.
6. Choose the mailbox that should hold the sales calendar. Put its user principal name in `OUTLOOK_CALENDAR_USER` (or `MICROSOFT_CALENDAR_USER`). The mailbox has to exist in that tenant.
7. Limit the app to that mailbox with an Exchange Online application access policy. `Calendars.ReadWrite` as an application permission can otherwise open every mailbox calendar in the tenant. Create a mail-enabled security group that contains only the calendar mailbox, then run `New-ApplicationAccessPolicy` with the app's client id, that group, and `AccessRight RestrictAccess`.
8. Set `OUTLOOK_ENABLED=true` only after the four values are non-empty. Until then the status endpoint reports Outlook disabled and Graph is not called.

The API posts to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with `grant_type=client_credentials` and `scope=https://graph.microsoft.com/.default`. The access token is cached in memory until one minute before `expires_in`. It is not logged and not sent to the sales client. Each Graph call waits at most 10 seconds.

### What is written

Events are created on that mailbox's default calendar:

- `POST /v1.0/users/{mailbox}/events`
- `PATCH /v1.0/users/{mailbox}/events/{id}`
- `DELETE /v1.0/users/{mailbox}/events/{id}`

The subject is the meeting title. The body is the meeting kind, the person's name, and the Senoria meeting id. No attendees are added, and reminders are off, so the lead is not emailed an invitation. `transactionId` on create is the Senoria meeting id, which lets Graph return the same event if a create is retried before the id is stored.

`start` and `end` are sent as Graph `dateTimeTimeZone` values in UTC. Senoria stores `startAt` and `endAt` as UTC instants. `2026-10-20T19:30:00.000Z` is sent as `{ "dateTime": "2026-10-20T19:30:00.0000000", "timeZone": "UTC" }`. The `Z` suffix is not included, because Graph reads `dateTime` in the `timeZone` field.

The Graph event id is stored as `externalSource=outlook` and `externalId` on the meeting, with `lastSyncedAt`. Meeting API responses still omit those columns. The lead's external source is not changed.

### When it runs

`POST /api/v1/sales/meetings` creates the Outlook event when Outlook is enabled.

`PATCH /api/v1/sales/meetings/:id` updates that event when the meeting already has an Outlook `externalId`. A meeting saved while Outlook was off is not sent on edit. A Graph 404 on update creates a new event and stores the new id.

`DELETE /api/v1/sales/meetings/:id` deletes the Outlook event when an `externalId` is present. A Graph 404 is treated as already deleted. The Senoria row stays soft-deleted and keeps `externalId`.

A second push of the same meeting updates the stored event instead of creating another one.

A follow-up note that also creates a meeting does not call Graph. `POST /api/v1/sales/meetings/:id/outlook` pushes that meeting later.

### Push one meeting

`POST /api/v1/sales/meetings/:id/outlook`

Auth: `ADMIN`, or the `SALES` user who owns the meeting. Another salesperson receives `403`. A missing or deleted meeting is `404`. No request body.

The response uses the usual `{ success, message, data, timestamp, requestId }` envelope.

When Outlook is not enabled, the status is **200**. Graph is not called:

```json
{
  "synced": false,
  "reason": "outlook_not_configured"
}
```

That object is `data`. `success` is true. The meeting is unchanged.

When Outlook is enabled, the API creates the event, or updates it when `externalId` is already stored:

```json
{
  "synced": true,
  "eventId": "AAMkAGI2…"
}
```

`eventId` is the Graph id stored as `externalId`.

When Graph rejects the push, the status is still **200**. The meeting row is kept. `data` is `{ "synced": false, "reason": "outlook_sync_failed" }`. `syncError` on the meeting holds the status message.

### Failure behavior

The meeting is saved before Outlook is called. The request then waits for that Graph call. A Graph error does not change the HTTP status of create (`201`), update (`200`), or delete (`200`).

The error is one JSON line, `integration sync failed`, with `integration` `outlook`, `success` false, and the Senoria `meetingId`. The log does not include the client secret, the access token, or the Graph body. The meeting's `syncError` is a short message such as `Outlook request failed with status 500`. A create that fails leaves `externalId` null. An update or delete that fails keeps the previous `externalId`. Nothing is retried automatically. Saving the meeting again, or calling the push endpoint, runs a new attempt.

A flag set without all four values is disabled. Graph is not called and `syncError` is left null.

## Webhook limits and replay

Meta, RingCentral, and Zoho webhooks are public. This API does not rate-limit them. Before go-live, limit `POST /api/v1/webhooks/meta/leads`, `POST /api/v1/webhooks/zoho/leads`, and `POST /api/v1/webhooks/ringcentral/calls` on the reverse proxy. Count the Meta challenge `GET` and the RingCentral `Validation-Token` handshake in that limit. 60 requests per minute per source IP is enough for lead ads, Zoho workflow delivery, and call-log delivery.

A repeated delivery is safe because the external id is stored:

- A Meta `leadgen_id` that is already stored returns the existing lead. Graph is not called again.
- A RingCentral session id that is already stored does not create another call or timeline row. RingCentral is not called when that row already has a recording URL. A later delivery can still fill a missing URL.
- There is no timestamp window. A captured request with a valid Meta signature or RingCentral verification token can be posted again. The second delivery does not create a second row.
- A Zoho lead id that is already stored updates that lead and does not create another one. A second identical body does not add another timeline row. Zoho is not called when the body already includes the lead fields.
- Outlook has no inbound webhook. Pushing the same meeting again updates the stored event. The Graph create sends the Senoria meeting id as `transactionId`. Pushing the same note again updates the stored CRM note.

Each vendor outcome is one JSON log line. The fields are `integration`, `success`, and whichever of `externalId`, `leadId`, `meetingId`, `callId`, and `noteId` apply. A skipped Meta lead or a non-voice RingCentral record uses the same ids with `success` false. The line does not include access tokens, client secrets, webhook secrets, or vendor bodies.

## Stored links

`leads`, `lead_timeline_events` (notes are timeline rows), `sales_calls`, and `sales_meetings` have nullable `external_source`, `external_id`, `last_synced_at`, and `sync_error`. Sales API responses do not include these fields.

`external_source` is null or one of `meta`, `ringcentral`, `zoho`, `outlook`. A source and an id are stored together or not at all. A non-null pair is unique per table. Meta lead intake writes `meta`. Zoho inbound writes `zoho` on a new lead, and on an existing lead that has no external source yet. A lead that already has another source keeps it, and the CRM id goes on `zoho_record_id`. Zoho note sync writes `zoho` on the note, and on the lead only when that lead does not already have an external source. Leads also have `zoho_record_id` for the CRM record. RingCentral call-log intake writes `ringcentral` on the call. It does not set the lead's external source. Outlook meeting sync writes `outlook` on the meeting. It does not set the lead's external source.

## Go-live checklist when client provides accounts

Leave every flag unset, or set to anything other than the string `true`, until that vendor's required values are filled. `GET /api/v1/integrations/status` then shows `configured: true` and `enabled: false` for that vendor. Set the flag to `true` only after that. The same request then shows `enabled: true`. A flag without the required values stays disabled and does not call the vendor.

Creating a lead, saving a note, logging a call, and saving a meeting keep their normal HTTP status if a vendor later fails. With every flag false, those requests do not call Meta, Zoho, RingCentral, or Microsoft.

### Meta — then set `META_LEADS_ENABLED=true`

Required:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_PAGE_ID`
- `META_PAGE_ACCESS_TOKEN`
- `META_WEBHOOK_VERIFY_TOKEN`

Optional:

- `META_GRAPH_API_VERSION`
- `META_LEAD_FIELD_MAP`
- `META_LEAD_FIELD_MAP_FILE`

Subscribe the Page to `leadgen`. Set the callback to `GET` and `POST /api/v1/webhooks/meta/leads`. The verify token in Meta is `META_WEBHOOK_VERIFY_TOKEN`. The challenge answers while the flag is still false.

### RingCentral — then set `RINGCENTRAL_ENABLED=true`

Required:

- `RINGCENTRAL_CLIENT_ID`
- `RINGCENTRAL_CLIENT_SECRET`
- `RINGCENTRAL_SERVER_URL`
- `RINGCENTRAL_JWT`
- `RINGCENTRAL_ACCOUNT_ID`
- `RINGCENTRAL_EXTENSION_ID`
- `RINGCENTRAL_FROM_NUMBER`

`RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` does not affect `configured`. Set it to the subscription verification token. Production rejects the call-log webhook when it is empty.

Create the call-log subscription to `POST /api/v1/webhooks/ringcentral/calls`. The `Validation-Token` handshake answers while the flag is still false, after the verification check.

### Zoho notes — then set `ZOHO_ENABLED=true`

Required for note push and for an id-only inbound fetch:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ACCOUNTS_DOMAIN` (`accounts.zohocloud.ca` for this org)
- `ZOHO_API_DOMAIN` (`www.zohoapis.ca` for this org)

Optional:

- `ZOHO_CRM_MODULE` (`Leads` or `Contacts`, default `Leads`)

### Zoho leads — then set `ZOHO_INBOUND_ENABLED=true`

`ZOHO_WEBHOOK_SECRET` does not affect `configured`. The webhook rejects every post while it is empty.

Leave `ZOHO_OUTBOUND_ENABLED` unset. Lead push is not implemented.

Create the Leads workflow webhook to `POST https://<api-host>/api/v1/webhooks/zoho/leads` with header `X-Zoho-Webhook-Secret`. A correct secret returns `200` while inbound is still false and creates no lead. Full instructions are in the Zoho inbound leads section.

Optional:

- `ZOHO_LEAD_MAP`
- `ZOHO_LEAD_MAP_FILE` (default `config/zoho-lead-map.json`)

### Outlook — then set `OUTLOOK_ENABLED=true`

Required. For each name, the `OUTLOOK_` value is used when it is non-empty. The `MICROSOFT_` value is used only when the `OUTLOOK_` value is empty. `MICROSOFT_ENABLED` is read only when `OUTLOOK_ENABLED` is empty.

- `OUTLOOK_CLIENT_ID` or `MICROSOFT_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET` or `MICROSOFT_CLIENT_SECRET`
- `OUTLOOK_TENANT_ID` or `MICROSOFT_TENANT_ID`
- `OUTLOOK_CALENDAR_USER` or `MICROSOFT_CALENDAR_USER`

Grant the Graph application permission `Calendars.ReadWrite`, admin-consent it, and limit the app to that mailbox before setting the flag.

### Smoke while the flags are still false

`npm run integrations:smoke` runs the checks below. It needs a running API, an `ADMIN` or `SALES` access token, a lead that token can open, and a meeting that token can open.

```bash
export BASE_URL=http://127.0.0.1:3000
export ACCESS_TOKEN="paste-access-token"
export LEAD_ID="paste-lead-uuid"
export MEETING_ID="paste-meeting-uuid"
# Export these only when the server already has the same values.
# The challenge and handshake then succeed while the flags are still false.
# export META_WEBHOOK_VERIFY_TOKEN=
# export RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN=
# export ZOHO_WEBHOOK_SECRET=
# Set EXPECT_PRODUCTION=true when NODE_ENV is production and the RingCentral verification token is still empty.
npm run integrations:smoke
```

The same requests by hand:

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE_URL/api/v1/integrations/status"

curl -sS "$BASE_URL/api/v1/webhooks/meta/leads?hub.mode=subscribe&hub.verify_token=${META_WEBHOOK_VERIFY_TOKEN:-}&hub.challenge=smoke-challenge"

curl -sS -D - -o /dev/null -X POST \
  -H "Validation-Token: smoke-validation" \
  -H "Verification-Token: ${RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN:-}" \
  "$BASE_URL/api/v1/webhooks/ringcentral/calls"

curl -sS -D - -o /tmp/zoho-webhook-body.json -X POST \
  -H "Content-Type: application/json" \
  -H "X-Zoho-Webhook-Secret: not-the-secret" \
  -d '{"id":"zcrm_82810000000332025"}' \
  "$BASE_URL/api/v1/webhooks/zoho/leads"

curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" -X POST \
  "$BASE_URL/api/v1/leads/$LEAD_ID/calls/start"

curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" -X POST \
  "$BASE_URL/api/v1/sales/meetings/$MEETING_ID/outlook"
```

While every flag is false:

- Status: each of `meta`, `ringcentral`, `zoho`, and `outlook` has `enabled` false. `configured` is true only after that vendor's required values are non-empty.
- Meta challenge: `200` and the body `smoke-challenge` when `META_WEBHOOK_VERIFY_TOKEN` matches. Any other token is `403`.
- RingCentral handshake: `200` and the response header `Validation-Token: smoke-validation` when the verification token matches, or when that token is empty and `NODE_ENV` is not `production`. Production with an empty token is `403`.
- Zoho webhook: `403` when `X-Zoho-Webhook-Secret` does not match. With the matching secret and `ZOHO_INBOUND_ENABLED` still false, an empty JSON body is `200` and `results` is `[]`.
- Start a call: `200`, `success` true, and `data` `{ "started": false, "reason": "ringcentral_not_configured" }`.
- Outlook push: `200`, `success` true, and `data` `{ "synced": false, "reason": "outlook_not_configured" }`.

None of these call Meta, Zoho, RingCentral, or Microsoft.
