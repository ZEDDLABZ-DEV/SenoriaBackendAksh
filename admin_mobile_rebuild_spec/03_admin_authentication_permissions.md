# 03 — Admin Authentication, Roles, Permissions, and Tokens

## What this app is

**CONFIRMED.** The splash subtitle is “Company Representative”. The login badge string is “Admin Portal”. The only role accepted into the app is the string `ADMIN`.

## Login

**CONFIRMED** in `AuthController.login`.

1. The form requires a non-empty email matching `^[\w.+-]+@([\w-]+\.)+[\w-]{2,4}$` and a non-empty password. There is **no** minimum password length in the admin app. **Decided** for the server: reject passwords shorter than 6 characters. No required symbol or number. No account lockout. No multi-factor authentication.
2. `POST /auth/login` sends `{ "email", "password" }` only.
3. The response user is rejected when `user.role.toUpperCase() != "ADMIN"`. The snackbar is “Access denied. Only admin accounts can sign in to this app.” Tokens are **not** saved in that case. The access token from that response is discarded.
4. On success, tokens and the user JSON are stored, then the app navigates to the dashboard and starts client and appointment fetches.
5. `401` on login is shown as “Invalid email or password”, not the server message.
6. `422` shows the server message.

The role check in this app is client-side: tokens are saved only when `user.role` uppercases to `ADMIN`. **Decided** for the server as well. Login does not take `role`. The account stores it. There is exactly one `ADMIN` user, and every other user is `CAREGIVER`. The caregiver app continues only for `CAREGIVER`. A caregiver token is rejected on admin routes, including `GET /clients`, `GET /users/caregivers`, and `DELETE /appointments/{id}`.

## Headers

**CONFIRMED.**

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Accept` | `application/json` |
| `X-Client` | `senoria-admin/1.0.0` |
| `Authorization` | `Bearer <accessToken>` when a token is stored |

Login and refresh do not attach `Authorization`. Every other call does, when a token exists.

## Token storage

**CONFIRMED** in `TokenStorageService`.

| Item | Detail |
|---|---|
| Store | GetStorage container name `senoria_auth` (separate from SharedPreferences). |
| Keys | `access_token`, `refresh_token`, `access_token_expires_at` (epoch milliseconds). |
| `expiresIn` | Seconds. Expiry stored as `now + expiresIn` only when `expiresIn > 0`. |
| Buffer | Access token is treated as expired 5 minutes before the stored expiry. A token with `expiresIn: 3600` refreshes at 55 minutes. |
| Unknown expiry | A stored access token with no expiry signs the admin out on the next request. `expiresIn: 0` never starts a session. |

User profile storage is separate, in SharedPreferences (`StorageService`):

| Key | Content |
|---|---|
| `is_logged_in` | bool |
| `user_email` | string |
| `current_user` | JSON of `User.toJson()` |

`isLoggedIn` on the auth controller is **both** `is_logged_in` and a non-empty access token. Splash checks **only** `is_logged_in`. A stale flag with a missing token still opens the dashboard; the next API call then fails.

## Refresh

**CONFIRMED** in `ApiClient`.

1. Before each non-auth request, if a refresh token exists and the access token is inside the 5-minute buffer, `POST /auth/refresh` runs first. For `expiresIn: 3600` that is at 55 minutes.
2. Body: `{ "refreshToken": "<stored refresh token>" }`. No Authorization header.
3. On 2xx, `data.accessToken` replaces the access token. `data.refreshToken` replaces the refresh token only when it is a non-empty string. `expiresIn > 0` rewrites expiry.
4. A failed refresh returns false and does not clear tokens by itself.
5. If the original request returns `401`, one refresh is attempted and the request is retried once.
6. Concurrent 401s share a single refresh future.
7. If the retry is still `401`, or refresh fails, `SessionService.handleUnauthorized` clears tokens and the user record and navigates to login, unless the path is login/refresh or no access token was stored.
8. Session-end is de-duplicated so parallel 401s do not stack navigations.

The refresh response’s `refreshToken` is optional in this app. **Decided:** do not rotate. Login issues one refresh token valid for 7 days. Refresh returns a new access token and `expiresIn: 3600`, and omits `refreshToken`. The app keeps the stored refresh token and refreshes the access token at 55 minutes. The admin stays signed in until 7 days after login. After that, refresh fails and the session ends. **Decided:** `expiresIn: 0` on login or refresh signs the admin out and does not keep a session.

There is no refresh-token reuse detection, no logout-all-devices call, and no clock-skew handling beyond the 5-minute buffer.

## Logout

**CONFIRMED.** `AuthController.logout` calls `SessionService.endSession`. That clears GetStorage tokens and SharedPreferences session keys, clears in-memory clients and appointments, and goes to the login route. **No HTTP logout call is made.** **Decided:** the server still has `POST /auth/logout`, which revokes the current refresh token. This app does not call it, so a local sign-out does not revoke the 7-day token.

## Forgot password

**CONFIRMED.** The login screen has a “Forgot password?” button. It shows a snackbar: “Coming soon. Contact your administrator to reset your password.” No endpoint is called. **Decided:** the server has `POST /auth/forgot-password` and `POST /auth/reset-password`. A new password must be at least 6 characters. This app does not call either route.

## Authorization and permissions

**CONFIRMED.**

| Mechanism | Behavior |
|---|---|
| Role constant | `User.roleAdmin = 'ADMIN'` |
| Comparison | `toUpperCase()`, so `admin`, `Admin`, and `ADMIN` all pass |
| Permissions array | Parsed from login and stored |
| `User.hasPermission` | Implemented, never referenced by a screen or controller |
| `User.isAdmin` | Implemented, not used by the login gate (the gate compares the constant directly) |
| 403 | Mapped to `ForbiddenException` with default text “You are not allowed to perform this action.” Callers that catch `ApiException` show `e.message`. No screen hides buttons based on 403. |
| Per-route guards | None. Any logged-in session can open every route. Splash does not re-check the role. |

Permission string values are **not used.** **Decided:** `permissions` is always `[]`. The server does not reject a call based on a permission string. The admin app stores the array and never reads it. Route access uses the stored account role.

Privileged operations this app performs, which the server should restrict to admins (**INFERRED** from the fact that a caregiver-scoped app uses different paths — see shared contracts):

- List every client (`GET /clients`), not a caregiver’s caseload.
- Create and update clients.
- List every caregiver (`GET /users/caregivers`). **Decided:** this list omits turned-off caregivers. The web portal creates caregiver accounts and can turn them off. Neither phone calls those routes.
- List, create, update, and delete every appointment.
- Create care plans and care-plan items.
- Create and delete client hazards.
- Read organization-wide dashboard counts.

## Session startup order

**CONFIRMED** in `main.dart` and `InitialBinding`.

1. `StorageService` and `TokenStorageService` initialize before `runApp`.
2. `AuthController`, `ClientController`, and `AppointmentController` are permanent.
3. Splash waits 800 ms, then routes on the SharedPreferences flag alone.
4. `ClientController.onReady` and `AppointmentController.onReady` and `DashboardController.onReady` fetch only when `isLoggedIn` is true (flag **and** token).

## Logging caution

**CONFIRMED** in `main.dart` and `ApiLogger.logAccessToken`. When navigation reaches the dashboard, the app prints the **full** access token to the console. Request logs mask `Authorization` to a short prefix and suffix. This document does not reproduce any token. A replacement portal should not copy the full-token log.

## What is not established

- Token signing algorithm, issuer, audience, and claims. **Decided.** HS256. Claim: `sub` (user id) only. No `role` claim. The server loads the account from `sub`. Issuer is this API. Audience is not checked by the apps. Both apps still treat the token strings as opaque.
- Whether `expiresIn` is access-token lifetime only. **Decided.** Yes. Login and refresh return `3600` (1 hour). The refresh token has its own 7-day lifetime and is not sent as `expiresIn`.
- Refresh-token lifetime and revocation. **Decided.** 7 days from login. Not rotated. `POST /auth/logout` revokes that token. This app does not call logout, so clearing the phone does not revoke the server token before those 7 days.
- Whether 403 vs 401 is used for “admin required”. **UNKNOWN**. The app handles both, differently.
- Multi-factor authentication, password policy, and account lockout. **Decided.** No MFA. No lockout. Password length at least 6. The admin UI still allows a shorter value through to the server.
