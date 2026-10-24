# 10 — Admin Source Reference Map

Paths are relative to the repository root. Line numbers refer to the source as read for this audit. If a later edit shifts lines, search for the symbol.

The Flutter app was not modified.

## Networking

| Symbol | File | Lines | Role |
|---|---|---|---|
| `ApiConstants` | `lib/shared/services/api/api_constants.dart` | 1–28 | Host, `/api/v1`, timeouts, `X-Client`, bearer helper |
| `ApiEndpoints` | `lib/shared/services/api/api_endpoints.dart` | 1–65 | All relative paths |
| `ApiClient` | `lib/shared/services/api/api_client.dart` | 14–459 | Singleton HTTP, refresh, status mapping |
| `ApiClient._send` | same | 166–209 | Proactive refresh and one 401 retry |
| `ApiClient._performRefresh` | same | 293–341 | `POST /auth/refresh` |
| `ApiClient._handleResponse` | same | 343–405 | 2xx vs 400/401/403/404/422/5xx |
| `ApiClient._extractMessage` | same | 415–446 | Error JSON shapes |
| `ApiException` and subclasses | `lib/shared/services/api/api_exceptions.dart` | 1–85 | Typed errors |
| `ApiLogger` | `lib/shared/services/api/api_logger.dart` | 19–134 | Request/response logs; full token log at 69–83 |
| Barrel | `lib/shared/services/api/api.dart` | — | Re-exports the API module |

## Auth and session

| Symbol | File | Lines | Role |
|---|---|---|---|
| `AuthController.login` | `lib/features/auth/controllers/auth_controller.dart` | 59–118 | Login call and `ADMIN` gate (line 75) |
| `AuthController.logout` | same | 120–130 | Local sign-out |
| `User.roleAdmin` | `lib/shared/models/auth/user.dart` | 1–53 | Role constant, permissions parse |
| `LoginRequest` | `lib/shared/models/auth/login_request.dart` | 1–11 | |
| `LoginResponse`, `LoginData` | `lib/shared/models/auth/login_response.dart` | 3–67 | |
| `RefreshTokenResponse` | `lib/shared/models/auth/refresh_response.dart` | 4–42 | |
| `TokenStorageService` | `lib/shared/services/token_storage_service.dart` | 4–74 | GetStorage `senoria_auth` |
| `StorageService` | `lib/shared/services/storage_service.dart` | 8–49 | SharedPreferences user |
| `AppStorageKeys` | `lib/core/constants/app_storage_keys.dart` | 1–7 | |
| `SessionService` | `lib/shared/services/session_service.dart` | 11–65 | 401 session end |
| `SplashScreen` | `lib/features/auth/views/splash_screen.dart` | 22–31 | Flag-only route choice |
| `_handleForgotPassword` | `lib/features/auth/views/login_screen.dart` | 403–414 | Placeholder |
| `main` token log | `lib/main.dart` | 38–46 | Prints access token on dashboard |
| `InitialBinding` | `lib/core/bindings/initial_binding.dart` | 6–13 | Permanent controllers |

## Routes

| Symbol | File | Lines |
|---|---|---|
| `AppRoutes` | `lib/core/routes/app_routes.dart` | 1–15 |
| `AppPages.routes` | `lib/core/routes/app_pages.dart` | 17–69 |

`editClient` is declared at `app_routes.dart` line 9 and is absent from `AppPages`.

## Dashboard

| Symbol | File | Lines |
|---|---|---|
| `DashboardController.fetchStats` | `lib/features/dashboard/controllers/dashboard_controller.dart` | 60–89 |
| `DashboardStats` | `lib/shared/models/dashboard_stats.dart` | 5–52 |
| `DashboardScreen` | `lib/features/dashboard/views/dashboard_screen.dart` | 13–240 |

## Clients

| Symbol | File | Lines | Role |
|---|---|---|---|
| `ClientController.fetchClients` | `lib/features/client/controllers/client_controller.dart` | 79–163 | `GET /clients` |
| `fetchClientById` | same | 185–232 | `GET /clients/{id}` |
| `createClientRemote` | same | 243–272 | `POST /clients` |
| `_buildClientPayload` | same | 280–394 | PUT shape A |
| `_buildDirectionsUpdatePayload` | same | 399–428 | PUT shape B |
| `updateClientRemote` | same | 437–505 | `PUT /clients/{id}` |
| `createCarePlan` | same | 900–968 | `POST /care-plans` |
| `createCarePlanDiet` | same | 1079–1117 | |
| `createCarePlanMedication` | same | 1126–1174 | |
| `createCarePlanHygiene` | same | 1183–1228 | |
| `createCarePlanTask` | same | 1237–1281 | |
| Local-only mutators | same | 636–890, 970–1071, 1283–1304 | Profile, services, care-plan edits, completion |
| `CreateClientRequest` | `lib/shared/models/create_client_request.dart` | 10–84 | |
| `ClientData` and nested types | `lib/shared/models/create_client_response.dart` | 11–1010 | Response graph and `toClient()` |
| `ClientsListResponse` | `lib/shared/models/clients_list_response.dart` | 4–112 | |
| `CreateClientScreen._submit` | `lib/features/client/views/create_client_screen.dart` | 92–147 | Form → request |
| `ClientDetailScreen` | `lib/features/client/views/client_detail_screen.dart` | 23–99 | Section composition |
| `DiagnosisSheet` | `lib/features/client/widgets/diagnosis_sheet.dart` | ~52 | Calls `updateClientRemote` |
| `LanguageInfoSheet` | `lib/features/client/widgets/language_info_sheet.dart` | ~56 | |
| `DirectionsSheet` | `lib/features/client/widgets/directions_sheet.dart` | ~80 | |
| `ServiceRequirementSheet` | `lib/features/client/widgets/service_requirement_sheet.dart` | ~86 | Local `updateServiceInfo` |
| `CarePlanSheet._save` | `lib/features/client/widgets/care_plan_sheet.dart` | 125–181 | Remote create vs local edit |
| Care item posts | same | ~570–596 | Diet, medication, hygiene, task |
| `HazardEditSheet` | `lib/features/client/widgets/hazard_edit_sheet.dart` | 43–92 | Client hazard API |
| `EditClientSheet` | `lib/features/client/widgets/edit_client_sheet.dart` | 12–97 | No caller |
| `ClientsScreen` search | `lib/features/client/views/clients_screen.dart` | 72–79 | |

## Appointments and hazards

| Symbol | File | Lines | Role |
|---|---|---|---|
| `fetchAppointments` | `lib/features/appointment/controllers/appointment_controller.dart` | 88–148 | Paged `GET /appointments` |
| `fetchAppointmentById` | same | 156–199 | |
| `upsertAppointmentFromDetail` | same | 213–244 | Bridges detail → edit form |
| `fetchCaregivers` | same | 300–356 | |
| `fetchAppointmentTypes` | same | 371–412 | |
| `createAppointment` | same | 443–494 | |
| `updateAppointmentRemote` | same | 502–540 | |
| `deleteAppointmentRemote` | same | 549–588 | |
| `fetchHazards` / `addHazard` / `deleteHazard` | same | 629–731 | |
| `changeStatus` | same | 752–756 | No caller |
| Dummy seed | same | 52–55 | `DummyData.appointments()` |
| `AppointmentFormScreen._save` | `lib/features/appointment/views/appointment_form_screen.dart` | 217–389 | Create and update bodies |
| Time formatters | same | 478–488 | `yyyy-MM-dd`, `HH:mm` |
| Delete confirm | same | 490–528 | |
| `AppointmentDetailScreen` | `lib/features/appointment/views/appointment_detail_screen.dart` | 14–127 | |
| `AppointmentsScreen` | `lib/features/appointment/views/appointments_screen.dart` | 80–119 | Search and local status tabs |
| `AppointmentStatusX.fromApi` | `lib/shared/models/appointment.dart` | 19–47 | |
| `AppointmentDetail` | `lib/shared/models/appointment_detail.dart` | 8–335 | |
| `AppointmentListItem` | `lib/shared/models/appointment_list_item.dart` | 19–75 | |
| `AppointmentsListResponse` | `lib/shared/models/appointments_list_response.dart` | 7–76 | |
| `AppointmentType` | `lib/shared/models/appointment_type.dart` | 5–37 | |
| `Caregiver` | `lib/shared/models/caregiver.dart` | 1–42 | |
| `CaregiversListResponse` | `lib/shared/models/caregivers_list_response.dart` | 7–76 | |
| `Hazard.toCreateJson` | `lib/shared/models/hazard.dart` | 34–41 | |

## Care plan models

| File | Types |
|---|---|
| `lib/shared/models/care_plan.dart` | `CarePlan`, `CarePlanTask`, `CarePlanStatus`, `CarePlanTaskCategory`, `MedicationScheduleOptions` |
| `lib/shared/models/create_care_plan_request.dart` | `CreateCarePlanRequest`, `CreateCarePlanResponse` |
| `lib/shared/models/create_care_plan_diet_request.dart` | request |
| `lib/shared/models/care_plan_diet.dart` | `CarePlanDiet`, response |
| `lib/shared/models/create_care_plan_medication_request.dart` | request |
| `lib/shared/models/care_plan_medication.dart` | entity and response |
| `lib/shared/models/create_care_plan_hygiene_request.dart` | request |
| `lib/shared/models/care_plan_hygiene.dart` | entity and response |
| `lib/shared/models/create_care_plan_task_request.dart` | request |
| `lib/shared/models/care_plan_task_item.dart` | `CarePlanTaskItem`, response |
| `lib/shared/models/service_requirement.dart` | enums and local info object |
| `lib/shared/models/diagnosis.dart` | local `Diagnosis`, `DiagnosisInfo` |
| `lib/shared/models/language_info.dart` | local `LanguageInfo` |
| `lib/shared/models/directions.dart` | local `Directions` |
| `lib/shared/models/client.dart` | `Client`, `ClientAppointment`, `Gender` |
| `lib/shared/data/dummy_data.dart` | Local fixtures still seeded for appointments |

## Date helpers

| Symbol | File | Lines |
|---|---|---|
| `AppHelpers.formatApiDate` | `lib/core/utils/app_helpers.dart` | 25–28 |
| `AppHelpers.formatClockRange` | same | 45–52 |
| `AppHelpers.isValidEmail` | same | 103–105 |

## Caregiver app files used for `08` (outside this repo)

Not part of the admin tree. Cited so the comparison can be re-checked.

| File | Role |
|---|---|
| `senoria_seniors_caretaker/lib/services/api/api_endpoints.dart` | Caregiver paths |
| `senoria_seniors_caretaker/lib/services/api/api_constants.dart` | Same host and `/api/v1` |
| `senoria_seniors_caretaker/lib/services/api/api_client.dart` | Unwraps `data`; refresh; error shape |
| `senoria_seniors_caretaker/lib/models/login_response_model.dart` | Inner login data |
| `senoria_seniors_caretaker/lib/models/user_model.dart` | User fields |
| `senoria_seniors_caretaker/lib/models/refresh_token_response_model.dart` | Refresh data |
| `senoria_seniors_caretaker/lib/models/client_model.dart` | Client, care plan items, doctor fields |
| `senoria_seniors_caretaker/lib/models/appointment_model.dart` | Appointment detail fields the admin model lacks |
| `senoria_seniors_caretaker/lib/features/auth/controller/auth_controller.dart` | Commented login body with `role` |
| `senoria_seniors_caretaker/lib/features/appointment/controller/appointment_detail_controller.dart` | Commented cancel, completion, check-in |

## Stale drafts (do not implement from these)

| File | Why it is stale |
|---|---|
| `BACKEND_API_SPEC.md` (this repo) | Says the app is dummy-data only, suggests a different base URL, and uses role `representative`. |
| Caregiver `BACKEND_API_SPEC.md` | Suggests `api.senoria.com` and snake_case token names. The caregiver models read camelCase `accessToken`. |
