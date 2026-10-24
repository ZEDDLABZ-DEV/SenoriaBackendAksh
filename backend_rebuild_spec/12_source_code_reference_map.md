# 12 — Source Code Reference Map

Line numbers refer to the Flutter tree at the time of this audit. If a file shifts, search for the symbol in the Source column.

Root: the Flutter project that contains this `backend_rebuild_spec` folder.

## API infrastructure

| Topic | File | Symbol | Lines |
|---|---|---|---|
| Endpoint constants | `lib/services/api/api_endpoints.dart` | `ApiEndpoints` | 1–33 |
| Base URL, timeout, headers | `lib/services/api/api_constants.dart` | `ApiConstants` | 5–23 |
| Headers actually sent | `lib/services/api/api_constants.dart` | `defaultHeaders` | 19–22 |
| Auth header only | `lib/services/api/api_client.dart` | `_buildHeaders` | 272–280 |
| Refresh headers, no timezone | `lib/services/api/api_client.dart` | `_performRefresh` | 196–199 |
| HTTP methods, envelope, refresh, errors | `lib/services/api/api_client.dart` | `ApiClient` | 29–354 |
| Refresh request | `lib/services/api/api_client.dart` | `_performRefresh` | 190–238 |
| Response unwrap and status switch | `lib/services/api/api_client.dart` | `_handleResponse` | 283–332 |
| `errors` parsing | `lib/services/api/api_client.dart` | `_parseErrors` | 334–345 |
| Exception types | `lib/services/api/api_exceptions.dart` | `ApiException` and subtypes | 5–78 |
| Barrel export | `lib/services/api/api.dart` | exports | 1–7 |
| Request logging | `lib/services/api/api_logger.dart` | `ApiLogger` | 8–92 |
| Token box | `lib/services/token_storage_service.dart` | `TokenStorageService` | 10–79 |
| User id read | `lib/services/token_storage_service.dart` | `userId` | 69–70 |
| Unused preference keys | `lib/core/utils/storage_keys.dart` | `StorageKeys` | 2–7 |
| ISO date sent to the API | `lib/core/utils/date_formatter.dart` | `isoDate` | 52–57 |
| GPS for check-in | `lib/services/location_service.dart` | `LocationService.getCurrentPosition` | 25–55 |
| Demo JSON and local mutations | `lib/services/demo_data.dart` | `DemoData` | 3–696 |

## Endpoints → callers

| Endpoint | Caller | Lines | Live or commented |
|---|---|---|---|
| `POST /auth/login` | `AuthController.login` | `lib/features/auth/controller/auth_controller.dart` 76–136 | Commented 88–100. Demo response 102–113 |
| Role gate | `AuthController.login` | same file 115–120 | Live, runs on the demo user too |
| `POST /auth/refresh` | `ApiClient._performRefresh` | `lib/services/api/api_client.dart` 190–232 | Live |
| 401 hook | `AuthController.onInit` | `auth_controller.dart` 38–39 | Live |
| Session clear | `AuthController.handleSessionExpired` | `auth_controller.dart` 150–167 | Live |
| Local logout | `AuthController.logout` | `auth_controller.dart` 138–145 | Live, no HTTP |
| Logout confirm UI | `dashboard_view.dart` | search `logoutConfirmTitle` | Live |
| Forgot password no-op | `LoginView` | `lib/features/auth/view/login_view.dart` 317–320 | Live, empty handler |
| `/auth/logout` (method unknown) | none | constant `api_endpoints.dart` 7 | Unused |
| `/auth/forgot-password` (method unknown) | none | `api_endpoints.dart` 9 | Unused |
| `/auth/reset-password` (method unknown) | none | `api_endpoints.dart` 10 | Unused |
| `GET /appointments/caregiver/{id}` | `DashboardController.fetchAppointments` | `dashboard_controller.dart` 29–51 | Commented 42–44 |
| `GET /appointments/{id}` | `AppointmentDetailController.fetchDetail` | `appointment_detail_controller.dart` 49–70 | Commented 61–63 |
| `PUT /appointments/{id}` | `cancelAppointment` | `appointment_detail_controller.dart` 194–207 | Commented 200–203 |
| `POST .../daily-completion/toggle` | `completeAppointment` | `appointment_detail_controller.dart` 169–191 | Commented 178–181 |
| Response has `id` → parse appointment | `_mutate` | `appointment_detail_controller.dart` 212–228 | Live control flow |
| `GET /clients/caregiver/{id}` | `ClientsController._requestPage` | `clients_controller.dart` 108–166 | Commented 119–127 |
| Query keys `page`, `pageSize`, `status`, `search` | `_requestPage` | `clients_controller.dart` 16–19 and 116–126 | Constants live, call commented |
| `GET /clients/{id}` | `ClientDetailController.fetchDetail` | `client_detail_controller.dart` 36–54 | Commented 48–50 |
| `POST /care-plans/{id}/check-in` | `checkIn` | `appointment_detail_controller.dart` 113–167 | Commented 126–141 |
| `POST /care-plans/{id}/completions/toggle` | `_toggle` | `appointment_care_plan_view.dart` 58–111 | Commented 77–84 |
| `itemType` literals | checklist sections | `appointment_care_plan_view.dart` 174, 197, 222, 245 | Live: `task`, `medication`, `diet`, `hygiene` |

## Models

| Model | File | `fromJson` lines |
|---|---|---|
| `UserModel` | `lib/models/user_model.dart` | 23–37 |
| `LoginResponseModel` | `lib/models/login_response_model.dart` | 17–26 |
| `RefreshTokenResponseModel` | `lib/models/refresh_token_response_model.dart` | 13–18 |
| `PaginationMetaModel` | `lib/models/pagination_meta_model.dart` | 19–28 |
| `AppointmentModel` | `lib/models/appointment_model.dart` | 74–114 |
| Date parse | same | 116–120 |
| Status getters | same | 220–275 |
| Care-plan completion gate | same | `allCarePlanItemsCompleted` 279–296 |
| `AppointmentClientModel` | same | 390–429 |
| `ClientLanguageModel` | same | 447–452 |
| `ClientHazardModel` | same | 475–482 |
| `EmergencyContactModel` | same | 502–509 |
| `AppointmentCaregiverModel` | same | 529–536 |
| `ClientModel` | `lib/models/client_model.dart` | 136–176 |
| Address nested or flat | same | `_addressField` 189–198 |
| `DiagnosisModel` | same | 223–232 |
| `ServiceRequirementModel` | same | 253–260 |
| `CarePlanModel` | same | 307–326 |
| Goals alternate shapes | same | `_stringList` 331–349 |
| `CareTaskModel` | same | 368–375 |
| `CareMedicationModel` | same | 397–406 |
| `CareDietModel` | same | 426–433 |
| `CareHygieneModel` | same | 453–460 |
| `ClientAppointmentModel` | same | 515–533 |

## Screens and local rules

| Workflow | File | What to read |
|---|---|---|
| Routes | `lib/core/routes/app_routes.dart` | all constants, lines 5–13 |
| Route table | `lib/core/routes/app_pages.dart` | `AppPages.pages` 24–84 |
| Splash session choice | `lib/features/auth/view/splash_view.dart` | `_decideRoute` 37–47 |
| Login form | `lib/features/auth/view/login_view.dart` | email, password, forgot button |
| Dashboard fetch and counts | `lib/features/dashboard/controller/dashboard_controller.dart` | whole file |
| Local appointment filters | `lib/features/dashboard/view/all_appointments_view.dart` | `_filtered` 48–65 |
| Status chip | `lib/shared/widgets/appointment_card.dart` | `_statusChip` 19–42 |
| Client paging | `lib/features/client/controller/clients_controller.dart` | whole file |
| Client profile sections | `lib/features/client/view/client_detail_view.dart` | diagnoses, care plans, doctor rows |
| Read-only care plan | `lib/features/client/view/care_plan_detail_view.dart` | no `ApiClient` |
| Appointment actions | `lib/features/appointment/view/appointment_detail_view.dart` | action bar 26–38, complete/cancel 552–574, future lock 596–600 |
| Diagnoses placeholder on the visit | same | `_UnavailableSection` 83–89 |
| Per-plan check-in card | same | `_CarePlanCard` 1599–1791 |
| Checklist | `lib/features/appointment/view/appointment_care_plan_view.dart` | `_toggle` |
| App start | `lib/main.dart` | `GetStorage.init`, `TokenStorageService.init` 26–27 |
| Dependencies | `pubspec.yaml` | `get`, `http`, `get_storage`, `geolocator` |

## Demo data as fixture source

`lib/services/demo_data.dart` is sample data, not a server. Use it to see realistic field combinations.

| Behavior | Lines |
|---|---|
| Clients page envelope `{ data, meta }` | 43–75 |
| Check-in mutates `checkInTime` and `dailyVisitStatus: in_progress` | 78–88. Demo only. The server leaves `dailyVisitStatus` as `pending` |
| Complete sets `completedToday`, `dailyVisitStatus: completed`, `checkOutTime` | 91–101 |
| Cancel sets `appointmentStatus`, `cancellationReason`, `dailyVisitStatus` | 104–114 |
| Item toggle returns `{ completed }` | 117–147 |
| Care plan JSON | `_carePlan` 417–488 |
| Client JSON including nested address and `doctor_visit` | `_client` 491–618 |
| Appointment JSON including flat location | `_appointment` 621–694 |
| Known appointment types and statuses | `_build` 317–411 |

## Request gaps confirmed in source

These are the current request shapes. They are not the decided server rules. See `10_open_questions_and_assumptions.md`.

| Gap | Evidence | Server consequence |
|---|---|---|
| No `X-Timezone` | `defaultHeaders` is `Content-Type` and `Accept` only. `_buildHeaders` adds `Authorization` only | Missing header means `America/Vancouver`. Safe without a client change |
| Cancel omits `cancellationReason` | `appointment_detail_controller.dart` 200–203 sends only `appointmentStatus` | 422. The typed reason never leaves the device. No safe server substitute |
| Check-in omits `appointmentId` | `appointment_detail_controller.dart` 129–136 sends `timestamp`, `location`, and `date` | Bind only when one visit matches. Two matches return 422 |

## Not part of the contract

| Path | Reason |
|---|---|
| `lib/shared/models/client.dart` | No JSON, no imports from features |
| `lib/shared/models/appointment.dart` | Same |
| `lib/shared/models/care_plan.dart` | Same |
| `lib/shared/models/diagnosis.dart` | Same |
| `lib/shared/models/hazards.dart` | Same |
| `lib/shared/models/directions.dart` | Same |
| `lib/shared/models/contact_info.dart` | Same |
| `lib/shared/models/language_info.dart` | Same |
| `lib/shared/models/service_requirement.dart` | Same |
| `lib/core/theme/app_colors.dart` | Visual only |
| `lib/core/theme/app_strings.dart` | Copy. Useful for status labels and validation text, not for JSON keys |
| `ios/`, `android/`, plugin symlinks | No app API definitions |

## Search patterns for a later session

Run these from the Flutter project root if line numbers drift:

```text
ApiEndpoints
SERVER_DOWN
ApiClient.instance
fromJson
appointmentStatus
dailyVisitStatus
completedToday
```

Every `SERVER_DOWN` hit is a call site that must keep its current path and body when it is uncommented.
