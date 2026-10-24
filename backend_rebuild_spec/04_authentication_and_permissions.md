# 04 — Authentication and Permissions

## Summary

| Question | Answer | Status |
|---|---|---|
| Login path | `POST /api/v1/auth/login` | CONFIRMED |
| Registration | Not present | CONFIRMED absent |
| Logout API | Constant exists. App does not call it | CONFIRMED |
| Tokens | `accessToken` and `refreshToken` strings | CONFIRMED |
| JWT or opaque | Access token is a JWT. Refresh token is opaque. The app does not decode either | DECIDED |
| Storage | GetStorage box `auth_box` | CONFIRMED |
| Header | `Authorization: Bearer <accessToken>` | CONFIRMED |
| Cookies | Not used | CONFIRMED |
| Refresh | `POST /auth/refresh` with `{ "refreshToken" }`, no bearer header, once per 401 | CONFIRMED |
| Local expiry | `expiresIn` is ignored after parse | CONFIRMED |
| Password reset / OTP | Not used by this app. An admin sets the caregiver password | DECIDED |
| Role | Login body sends `CAREGIVER`. Response role must match | CONFIRMED |
| Permissions | Always `[]`. Never enforced in the caregiver UI | DECIDED |
| User object with tokens | Yes, `data.user` | CONFIRMED |

No production passwords, tokens, or API keys appear in source. Demo tokens in `DemoData` / the login stub are the literals `demo-access-token` and `demo-refresh-token`. They are not credentials for a real server. Do not copy them into production.

## Login

**CONFIRMED.** `AuthController` (`lib/features/auth/controller/auth_controller.dart`).

Client validation before the request:

| Field | Rule |
|---|---|
| Email | Required, trimmed, must match `^[\w.\-]+@([\w\-]+\.)+[\w\-]{2,}$` |
| Password | Required, length at least 6 |

Request body:

```json
{
  "email": "caregiver@example.com",
  "password": "example-password",
  "role": "CAREGIVER"
}
```

`role` is the private constant `_caregiverRole`. The UI cannot choose a role.

Expected `data`:

```json
{
  "user": {
    "id": "cg_123",
    "email": "caregiver@example.com",
    "firstName": "Alex",
    "lastName": "Rivera",
    "role": "CAREGIVER",
    "avatar": null,
    "permissions": []
  },
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>",
  "expiresIn": 86400
}
```

**DECIDED:** `expiresIn` is `86400` (24 hours). The demo stub used `3600`. Any positive integer parses. The app will not refresh early. It waits for HTTP 401, then refreshes. The access token is a JWT. The app stores it as a string and does not read `exp`. The refresh token is an opaque random string, not a JWT.

Post-parse gate: if `user.role.toUpperCase() != "CAREGIVER"`, storage is cleared and the user stays on login with `This account is not authorized to use the Caregiver app.`

On success the app writes tokens and `user.toJson()`, then opens `/dashboard`.

### Login failures (CONFIRMED client behavior)

| Condition | What the caregiver sees |
|---|---|
| HTTP 401 | `Invalid email or password. Please try again.` Server `message` is discarded |
| HTTP 422 `ValidationException` | Server `message` |
| Other `ApiException` | Server `message` |
| Thrown parse error | `Something went wrong. Please try again.` |
| Role mismatch | Role-not-allowed copy, session cleared |

**Recommendation:** invalid credentials return 401. Validation problems return 422 with `message` and optional `errors`. Do not return 200 with `success: false`, because the client would try to parse `data` as a login.

## Token storage (CONFIRMED)

`lib/services/token_storage_service.dart`.

| GetStorage key | Contents |
|---|---|
| `access_token` | access token string |
| `refresh_token` | refresh token string |
| `user` | JSON string of `UserModel.toJson()` |

`userId` reads `user['id']` as a `String`. A numeric `id` in storage would yield null and block appointment and client fetches with "Unable to identify the logged-in caregiver."

`StorageKeys` (`is_logged_in`, `user_email`) and the `SharedPreferences` instance in `main.dart` are not used by the auth flow. Splash treats "has access token" as logged in.

## Authorization header (CONFIRMED)

```text
Authorization: Bearer <access_token>
```

Applied when `requiresAuth` is true (the default) and the token is non-empty. Login sets `requiresAuth: false`. Refresh builds its own headers and does not send `Authorization`.

If `requiresAuth` is true and the token is missing, the request is still sent without the header. The server should return 401.

## Refresh (CONFIRMED)

Trigger: authenticated call returns 401, the call is not `/auth/refresh`, and this is the first attempt.

1. Read `refresh_token`. Empty token skips refresh.
2. `POST /api/v1/auth/refresh` with JSON `{ "refreshToken": "..." }`.
3. Headers: `Content-Type` and `Accept` only.
4. On 2xx, parse `data` with `RefreshTokenResponseModel`.
5. If `accessToken` is non-empty, save both tokens. Empty new refresh token keeps the old one.
6. Retry the original method, URL, body, and query once.
7. Concurrent 401s share one in-flight refresh (`_refreshFuture`).

Refresh failure, or a second 401 after retry, calls `AuthController.handleSessionExpired`:

- Clears tokens and user.
- Navigates to `/login` unless already there.
- Snackbar: `Your session has expired. Please log in again.`

**DECIDED server rules:**

| Case | Response |
|---|---|
| Refresh token valid and unused | 200, a new JWT access token, and a new opaque refresh token. `expiresIn` is `86400` |
| Refresh token revoked, expired, or unknown | 401 |
| Reuse of a rotated refresh token | 401. The previous token is already invalid |

The new `refreshToken` must be non-empty. An empty string makes the app keep the old token, which the server has already invalidated. Access tokens last 24 hours. Refresh tokens last 30 days. The app still does not read `exp`. It waits for 401.

## Logout (CONFIRMED)

Dashboard confirms, then `AuthController.logout` clears storage and opens login. No server call.

**DECIDED:** caregiver v1 does not call logout. Refresh tokens issued to the phone stay valid until they expire or are rotated. That is a consequence of the local logout, not a change to the login contract. The admin application can revoke a caregiver by deactivating the user. Do not require this app to call `/auth/logout`.

## Forgot and reset password (DECIDED)

Constants exist for `/auth/forgot-password` and `/auth/reset-password`. Their HTTP methods are not in the source. Login shows "Forgot password?" with an empty handler (`login_view.dart` 320).

**DECIDED:** there is no caregiver email, OTP, or reset-link flow. An admin sets the caregiver password in the admin application. Do not invent OTP length, reset tokens, or email templates for this app.

## Roles and permissions

| Item | Evidence |
|---|---|
| Mobile role string | `CAREGIVER` |
| Other roles on caregiver login | Reject. Do not issue tokens. The app would also clear them after a 200, but the server must not mint them |
| `permissions` | Always `[]` |
| Permission checks in the app | None |
| Admin role | `ADMIN`, only in the separate admin application. It must not pass the caregiver role check |

**DECIDED access rule for caregiver tokens:**

| Resource | Allowed |
|---|---|
| Own user id in `/appointments/caregiver/{id}` and `/clients/caregiver/{id}` | Yes |
| Another caregiver's id | 404 |
| Appointment, client, or care plan not assigned to the token's user | 404 |
| Admin user management | No |

The client shows `message` for 404. Hidden resources use 404 rather than 403.

## Session start (CONFIRMED)

`SplashView` waits about 1.3 seconds, then:

- access token present → `/dashboard`
- absent → `/login`

No token introspection call. An expired access token still opens the dashboard; the first API 401 refreshes or logs out.

## What the backend must store

**INFERRED**, because the app never sends a password back and never reads a password hash:

| Stored | Returned to the app |
|---|---|
| Password hash | Never |
| JWT signing key for the access token | The access token string at login and refresh. Do not store the raw JWT as the only secret; verify its signature and `exp` |
| Refresh token hash | The raw opaque token once, at login and again on every refresh. The previous hash is revoked |
| User profile fields listed on `UserModel` | Yes, inside login `data.user` |

Do not return the password hash, internal admin notes, or other caregivers' emails in caregiver payloads.
