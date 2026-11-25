import { Router, type Request } from "express";
import { asyncHandler } from "../http/asyncHandler";
import { getRequestContext } from "../http/requestContext";
import { errorBody, sendData } from "../http/respond";
import { forbidden } from "../lib/errors";
import { requireRoles } from "../middleware/auth";
import { timezoneMiddleware } from "../middleware/timezone";
import {
  approveAccountDeletion,
  listAccountDeletionRequests,
  rejectAccountDeletion,
  requestAccountDeletion,
} from "../services/accountDeletion.service";
import { forgotPassword, login, loginAdmin, logout, refreshSession, resetPassword } from "../services/auth.service";
import { cancelAppointment, completeDay, getAppointment, listAppointments } from "../services/appointment.service";
import {
  acceptCoverage,
  getCoverage,
  listMyCoverage,
  listNotifications,
  listOpenCoverage,
  markAllNotificationsRead,
  markNotificationRead,
  requestCoverage,
  withdrawCoverage,
} from "../services/coverage.service";
import { registerDevice, removeDevice } from "../services/notificationDevice.service";
import {
  appointmentTypes,
  createAppointment,
  deleteAppointment,
  listAppointmentsAdmin,
  updateAppointmentAdmin,
} from "../services/appointmentAdmin.service";
import {
  checkIn,
  createCarePlan,
  createDiet,
  createHygiene,
  createMedication,
  createTask,
  deleteCarePlan,
  deleteDiet,
  deleteHygiene,
  deleteMedication,
  deleteTask,
  toggleCompletion,
  updateCarePlan,
  updateDiet,
  updateHygiene,
  updateMedication,
  updateTask,
} from "../services/carePlan.service";
import {
  changeCaregiverPassword,
  createCaregiver,
  createPosition,
  deactivateCaregiver,
  deletePosition,
  listCaregivers,
  listPositions,
  updatePosition,
} from "../services/caregiverAdmin.service";
import {
  createDoctorAppointment,
  createDoctorAppointmentType,
  deleteDoctorAppointment,
  deleteDoctorAppointmentType,
  getDoctorAppointment,
  listDoctorAppointmentTypes,
  listDoctorAppointments,
  listDoctorAppointmentsForClient,
  updateDoctorAppointment,
  updateDoctorAppointmentType,
} from "../services/doctorAppointment.service";
import { getClient, listClients } from "../services/client.service";
import {
  createClient,
  createHazard,
  createServiceRequirement,
  deleteClient,
  deleteHazard,
  deleteServiceRequirement,
  listClientsAdmin,
  listHazards,
  updateClient,
  updateHazard,
  updateServiceRequirement,
} from "../services/clientWrite.service";
import { createService, deleteService, listServices, updateService } from "../services/careService.service";
import { dashboardStats } from "../services/dashboard.service";
import { createCall, getCall, listCalls } from "../services/calls.service";
import {
  createMeeting,
  deleteMeeting,
  listMeetings,
  pushMeetingOutlook,
  updateMeeting,
} from "../services/meetings.service";
import {
  addLeadNote,
  assignLead,
  assignmentState,
  changeLeadStage,
  createLead,
  getLead,
  listLeads,
  queueSummary,
  requestDayWindow,
  updateLead,
  type SalesActor,
} from "../services/leads.service";
import {
  changeSalesPassword,
  createSales,
  deactivateSales,
  listSales,
  getSales,
  revokeSalesSessions,
  salesDashboard,
} from "../services/sales.service";
import { ingestMetaLeadgen } from "../integrations/meta/leads";
import { ingestZohoLeads } from "../integrations/zoho/inbound";
import { isZohoInboundEnabled, zohoWebhookAuthorized } from "../integrations/zoho/webhook";
import { logIntegration } from "../integrations/log";
import { metaChallenge, metaPostDecision } from "../integrations/meta/signature";
import { ingestRingCentralCalls } from "../integrations/ringcentral/ingest";
import { startLeadCall } from "../integrations/ringcentral/start";
import { ringCentralPostDecision } from "../integrations/ringcentral/webhook";
import { getIntegrationStatus, isIntegrationEnabled } from "../integrations/status";
import { getSalesperson, listSalespeople } from "../services/salespeople.service";
import { requireOwnedAppointment, requireOwnedCarePlan } from "../services/scope";
import { parseCreateAppointment, parseCancel, parseDailyCompletion, parseUpdateAppointment } from "../validation/appointments";
import { parseCoverageReason, parseUnreadQuery } from "../validation/coverage";
import { parseRegisterDevice, parseRemoveDevice } from "../validation/devices";
import {
  parseCreateDoctorAppointment,
  parseDoctorAppointmentType,
  parseDoctorListQuery,
  parseUpdateDoctorAppointment,
} from "../validation/doctorAppointments";
import { parseAccountDeletionRequest, parseDeletionRequestStatus } from "../validation/accountDeletion";
import { parseCaregiverPassword, parseCreateCaregiver, parseCreateSales, parseForgotPassword, parseLogin, parsePosition, parseRefresh, parseResetPassword, parseSalesListStatus } from "../validation/auth";
import { parseCallListQuery, parseCreateCall } from "../validation/calls";
import { parseCreateMeeting, parseMeetingRangeQuery, parseUpdateMeeting } from "../validation/meetings";
import {
  parseAssignLead,
  parseCreateLead,
  parseLeadListQuery,
  parseLeadNote,
  parseLeadStage,
  parseOptionalTimeZoneOffset,
  parseQueueSummaryQuery,
  parseUpdateLead,
} from "../validation/leads";
import {
  parseCreateCarePlan,
  parseCreateDiet,
  parseCreateHygiene,
  parseCreateMedication,
  parseCreateTask,
  parseCheckIn,
  parseToggle,
  parseUpdateCarePlan,
  parseUpdateDiet,
  parseUpdateHygiene,
  parseUpdateMedication,
  parseUpdateTask,
} from "../validation/carePlans";
import {
  parseClientListQuery,
  parseCreateClient,
  parseHazard,
  parseServiceRequirement,
  parseUpdateClient,
  parseUpdateServiceRequirement,
} from "../validation/clients";
import { parsePageQuery } from "../validation/common";
import { parseHourAdjustment, parseReportFilters } from "../validation/reports";
import { parseServiceName } from "../validation/services";
import { adjustVisitHours, visitReport } from "../services/visitReport.service";
import { visitReportPdf } from "../services/visitReportPdf";
import {
  createTimeOff,
  deleteTimeOff,
  getAvailability,
  listTimeOff,
  replaceAvailability,
} from "../services/availability.service";
import { getSchedule, getScheduleSummary } from "../services/schedule.service";
import { createSeries, endSeries, getSeries, listSeries, updateSeries } from "../services/visitSeries.service";
import {
  parseAvailability,
  parseCreateSeries,
  parseFromDateQuery,
  parseMonthQuery,
  parseOptionalDateRange,
  parseRangeQuery,
  parseSeriesListQuery,
  parseTimeOff,
  parseUpdateSeries,
} from "../validation/schedule";

export const apiRouter = Router();

apiRouter.use(timezoneMiddleware);

const caregiver = requireRoles(["CAREGIVER"]);
const admin = requireRoles(["ADMIN"]);
const sales = requireRoles(["SALES"]);
const adminOrSales = requireRoles(["ADMIN", "SALES"]);
const either = requireRoles(["CAREGIVER", "ADMIN"]);
const signedIn = requireRoles(["CAREGIVER", "ADMIN", "SALES"]);

apiRouter.get("/webhooks/meta/leads", (req, res) => {
  const result = metaChallenge(req.query);
  if (!result.ok) {
    res.status(403).type("text/plain").send("Forbidden");
    return;
  }
  res.status(200).type("text/plain").send(result.challenge);
});

apiRouter.post(
  "/webhooks/meta/leads",
  asyncHandler(async (req, res) => {
    const decision = metaPostDecision(req);
    if (decision === "reject") {
      res.status(403).json({ received: false });
      return;
    }
    if (decision === "ignore" || !isIntegrationEnabled("meta")) {
      res.status(200).json({ received: true, results: [] });
      return;
    }
    const results = await ingestMetaLeadgen(req.body);
    res.status(200).json({ received: true, results });
  }),
);

apiRouter.post(
  "/webhooks/zoho/leads",
  asyncHandler(async (req, res) => {
    if (!zohoWebhookAuthorized(req.header("x-zoho-webhook-secret"))) {
      res.status(403).json({ received: false });
      return;
    }
    if (!isZohoInboundEnabled()) {
      res.status(200).json({ received: true, results: [] });
      return;
    }
    try {
      const results = await ingestZohoLeads(req.body);
      res.status(200).json({ received: true, results });
    } catch {
      logIntegration("failed", { integration: "zoho" });
      res.status(200).json({ received: true, results: [] });
    }
  }),
);

apiRouter.post(
  "/webhooks/ringcentral/calls",
  asyncHandler(async (req, res) => {
    const decision = ringCentralPostDecision(req);
    if (decision.kind === "reject") {
      res.status(403).json({ received: false });
      return;
    }
    if (decision.kind === "validate") {
      res.status(200).set("Validation-Token", decision.token).end();
      return;
    }
    if (!isIntegrationEnabled("ringcentral")) {
      res.status(200).json({ received: true, results: [] });
      return;
    }
    const results = await ingestRingCentralCalls(req.body);
    res.status(200).json({ received: true, results });
  }),
);

apiRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = parseLogin(req.body);
    const data = await login(body);
    sendData(res, data, "Signed in");
  }),
);

apiRouter.post(
  "/auth/refresh",
  asyncHandler(async (req, res) => {
    const body = parseRefresh(req.body);
    const data = await refreshSession(body.refreshToken);
    sendData(res, data, "Token refreshed");
  }),
);

apiRouter.post(
  "/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const body = parseForgotPassword(req.body);
    await forgotPassword(body.email);
    sendData(res, null, "If an account exists for that email, password reset has been started");
  }),
);

apiRouter.post(
  "/auth/reset-password",
  asyncHandler(async (req, res) => {
    const body = parseResetPassword(req.body);
    await resetPassword(body.token, body.password);
    sendData(res, null, "Password updated");
  }),
);

apiRouter.post(
  "/admin/auth/login",
  asyncHandler(async (req, res) => {
    const body = parseLogin(req.body);
    const data = await loginAdmin(body);
    sendData(res, data, "Signed in");
  }),
);

apiRouter.post(
  "/auth/logout",
  signedIn,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    await logout(context.user.id);
    sendData(res, null, "Signed out");
  }),
);

apiRouter.post(
  "/auth/account-deletion",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseAccountDeletionRequest(req.body);
    const data = await requestAccountDeletion(context.user.id, body.reason);
    sendData(res, data, "Account deletion request submitted");
  }),
);

apiRouter.get(
  "/account-deletion-requests",
  admin,
  asyncHandler(async (req, res) => {
    const query = parsePageQuery(req.query as Record<string, unknown>, 50);
    const status = parseDeletionRequestStatus(req.query as Record<string, unknown>);
    const data = await listAccountDeletionRequests(query, status);
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/account-deletion-requests/:id/approve",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await approveAccountDeletion(req.params.id, context.user.id);
    sendData(res, data, "Account deletion approved");
  }),
);

apiRouter.post(
  "/account-deletion-requests/:id/reject",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await rejectAccountDeletion(req.params.id, context.user.id);
    sendData(res, data, "Account deletion rejected");
  }),
);

apiRouter.get(
  "/salespeople",
  admin,
  asyncHandler(async (req, res) => {
    const status = parseSalesListStatus(req.query as Record<string, unknown>);
    sendData(res, await listSalespeople(status), "ok");
  }),
);

apiRouter.get(
  "/salespeople/:id",
  admin,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    sendData(res, await getSalesperson(actor, req.params.id, context.timeZone, offset), "ok");
  }),
);

apiRouter.get(
  "/integrations/status",
  adminOrSales,
  asyncHandler(async (_req, res) => {
    sendData(res, getIntegrationStatus(), "ok");
  }),
);

apiRouter.get(
  "/sales/dashboard",
  sales,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await salesDashboard(context.user.id);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/sales/meetings",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const query = parseMeetingRangeQuery(req.query as Record<string, unknown>);
    const context = getRequestContext(req);
    sendData(res, await listMeetings(actor, query, context.timeZone), "ok");
  }),
);

apiRouter.post(
  "/sales/meetings",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseCreateMeeting(req.body);
    sendData(res, await createMeeting(actor, body), "Meeting created", 201);
  }),
);

apiRouter.patch(
  "/sales/meetings/:id",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseUpdateMeeting(req.body);
    sendData(res, await updateMeeting(actor, req.params.id, body), "Meeting updated");
  }),
);

apiRouter.delete(
  "/sales/meetings/:id",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    sendData(res, await deleteMeeting(actor, req.params.id), "Meeting deleted");
  }),
);

apiRouter.post(
  "/sales/meetings/:id/outlook",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const data = await pushMeetingOutlook(actor, req.params.id);
    if (!data.synced) {
      const message =
        data.reason === "outlook_not_configured" ? "Outlook is not configured" : "Outlook did not save the event";
      sendData(res, data, message);
      return;
    }
    sendData(res, data, "Outlook event saved");
  }),
);

apiRouter.get(
  "/sales/assignment-state",
  adminOrSales,
  asyncHandler(async (_req, res) => {
    sendData(res, await assignmentState(), "ok");
  }),
);

apiRouter.get(
  "/leads/queues/summary",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const query = parseQueueSummaryQuery(req.query as Record<string, unknown>);
    const context = getRequestContext(req);
    const data = await queueSummary(actor, requestDayWindow(context.timeZone, query.timeZoneOffset), query.ownerId);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/leads",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const query = parseLeadListQuery(req.query as Record<string, unknown>);
    const context = getRequestContext(req);
    const data = await listLeads(actor, query, requestDayWindow(context.timeZone, query.timeZoneOffset));
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/leads",
  admin,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseCreateLead(req.body);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    const data = await createLead(actor, body, requestDayWindow(context.timeZone, offset));
    sendData(res, data, "Lead created", 201);
  }),
);

apiRouter.get(
  "/leads/:id",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    const data = await getLead(actor, req.params.id, requestDayWindow(context.timeZone, offset));
    sendData(res, data, "ok");
  }),
);

apiRouter.patch(
  "/leads/:id",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseUpdateLead(req.body);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    const data = await updateLead(actor, req.params.id, body, requestDayWindow(context.timeZone, offset));
    sendData(res, data, "Lead updated");
  }),
);

apiRouter.patch(
  "/leads/:id/stage",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseLeadStage(req.body);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    const data = await changeLeadStage(
      actor,
      req.params.id,
      body.stage,
      requestDayWindow(context.timeZone, offset),
    );
    sendData(res, data, "Stage updated");
  }),
);

apiRouter.post(
  "/leads/:id/assign",
  admin,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseAssignLead(req.body);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    const data = await assignLead(
      actor,
      req.params.id,
      body.ownerId,
      requestDayWindow(context.timeZone, offset),
    );
    sendData(res, data, "Lead assigned");
  }),
);

apiRouter.get(
  "/calls",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const query = parseCallListQuery(req.query as Record<string, unknown>);
    const context = getRequestContext(req);
    sendData(res, await listCalls(actor, query, context.timeZone), "ok");
  }),
);

apiRouter.post(
  "/calls",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseCreateCall(req.body);
    sendData(res, await createCall(actor, body), "Call logged", 201);
  }),
);

apiRouter.post(
  "/leads/:id/calls/start",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const data = await startLeadCall(actor, req.params.id);
    if (!data.started) {
      sendData(res, data, "RingCentral is not configured");
      return;
    }
    sendData(res, data, "Call started");
  }),
);

apiRouter.get(
  "/calls/:id",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    sendData(res, await getCall(actor, req.params.id), "ok");
  }),
);

apiRouter.post(
  "/leads/:id/notes",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const actor = salesActor(req);
    const body = parseLeadNote(req.body);
    const context = getRequestContext(req);
    const offset = parseOptionalTimeZoneOffset(req.query as Record<string, unknown>);
    const data = await addLeadNote(
      actor,
      req.params.id,
      body,
      requestDayWindow(context.timeZone, offset),
      context.timeZone,
      offset,
    );
    sendData(res, data, "Note added");
  }),
);

apiRouter.get(
  "/dashboard/stats",
  admin,
  asyncHandler(async (req, res) => {
    const offset = typeof req.query.timeZoneOffset === "string" ? req.query.timeZoneOffset : undefined;
    const data = await dashboardStats(offset);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/appointments/caregiver/:caregiverId",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await listAppointments(context.user.id, req.params.caregiverId, context.today);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/appointments/types",
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, appointmentTypes(), "ok");
  }),
);

apiRouter.get(
  "/appointments",
  admin,
  asyncHandler(async (req, res) => {
    const query = parsePageQuery(req.query as Record<string, unknown>, 100);
    const data = await listAppointmentsAdmin(query);
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/appointments",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateAppointment(req.body);
    const data = await createAppointment(body);
    sendData(res, data, "Appointment created");
  }),
);

apiRouter.get(
  "/appointments/:id",
  either,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await getAppointment(
      context.user.id,
      req.params.id,
      context.today,
      context.user.role === "ADMIN" ? "any" : "owner",
    );
    sendData(res, data, "ok");
  }),
);

apiRouter.put(
  "/appointments/:id",
  either,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    if (context.user.role === "CAREGIVER") {
      await requireOwnedAppointment(context.user.id, req.params.id);
      const body = parseCancel(req.body);
      const data = await cancelAppointment(context.user.id, req.params.id, body.cancellationReason, context.today);
      sendData(res, data, "Appointment cancelled");
      return;
    }
    const body = parseUpdateAppointment(req.body);
    const data = await updateAppointmentAdmin(req.params.id, body.present, body.value, context.today);
    sendData(res, data, "Appointment updated");
  }),
);

apiRouter.delete(
  "/appointments/:id",
  admin,
  asyncHandler(async (req, res) => {
    await deleteAppointment(req.params.id);
    sendData(res, null, "Appointment deleted");
  }),
);

apiRouter.post(
  "/appointments/:id/coverage",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseCoverageReason(req.body);
    const data = await requestCoverage(context.user.id, req.params.id, body.reason, context.today);
    sendData(res, data, "Other caregivers have been notified");
  }),
);

apiRouter.post(
  "/appointments/:id/coverage/withdraw",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await withdrawCoverage(context.user.id, req.params.id, context.today);
    sendData(res, data, "Coverage request withdrawn");
  }),
);

apiRouter.get(
  "/appointment-coverage/open",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    sendData(res, await listOpenCoverage(context.user.id, context.today), "ok");
  }),
);

apiRouter.get(
  "/appointment-coverage/mine",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    sendData(res, await listMyCoverage(context.user.id, context.today), "ok");
  }),
);

apiRouter.get(
  "/appointment-coverage/:id",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    sendData(res, await getCoverage(context.user.id, req.params.id, context.today), "ok");
  }),
);

apiRouter.post(
  "/appointment-coverage/:id/accept",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await acceptCoverage(context.user.id, req.params.id, context.today);
    sendData(res, data, "Visit transferred");
  }),
);

apiRouter.get(
  "/notifications",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const unreadOnly = parseUnreadQuery(req.query as Record<string, unknown>);
    sendData(res, await listNotifications(context.user.id, unreadOnly), "ok");
  }),
);

apiRouter.post(
  "/notifications/read-all",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    sendData(res, await markAllNotificationsRead(context.user.id), "Notifications marked read");
  }),
);

apiRouter.post(
  "/notification-devices",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseRegisterDevice(req.body);
    const data = await registerDevice(context.user.id, body.token, body.platform);
    sendData(res, data, "Device registered");
  }),
);

apiRouter.delete(
  "/notification-devices",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseRemoveDevice(req.body);
    sendData(res, await removeDevice(context.user.id, body.token), "Device removed");
  }),
);

apiRouter.post(
  "/notifications/:id/read",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    sendData(res, await markNotificationRead(context.user.id, req.params.id), "Notification marked read");
  }),
);

apiRouter.get(
  "/schedule",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const query = parseRangeQuery(req.query as Record<string, unknown>);
    sendData(res, await getSchedule(query, context.today), "ok");
  }),
);

apiRouter.get(
  "/schedule/summary",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const query = parseMonthQuery(req.query as Record<string, unknown>);
    sendData(res, await getScheduleSummary(query, context.today), "ok");
  }),
);

apiRouter.get(
  "/visit-series",
  admin,
  asyncHandler(async (req, res) => {
    const filters = parseSeriesListQuery(req.query as Record<string, unknown>);
    sendData(res, await listSeries(filters), "ok");
  }),
);

apiRouter.post(
  "/visit-series",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseCreateSeries(req.body);
    sendData(res, await createSeries(body, context.today), "Visits scheduled");
  }),
);

apiRouter.get(
  "/visit-series/:id",
  admin,
  asyncHandler(async (req, res) => {
    sendData(res, await getSeries(req.params.id), "ok");
  }),
);

apiRouter.put(
  "/visit-series/:id",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseUpdateSeries(req.body);
    sendData(res, await updateSeries(req.params.id, body, context.today), "Schedule updated");
  }),
);

apiRouter.delete(
  "/visit-series/:id",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const fromDate = parseFromDateQuery(req.query as Record<string, unknown>);
    sendData(res, await endSeries(req.params.id, fromDate, context.today), "Schedule ended");
  }),
);

apiRouter.get(
  "/doctor-appointment-types",
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, await listDoctorAppointmentTypes(), "ok");
  }),
);

apiRouter.post(
  "/doctor-appointment-types",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseDoctorAppointmentType(req.body);
    const data = await createDoctorAppointmentType(body.name);
    sendData(res, data, "Appointment type created");
  }),
);

apiRouter.put(
  "/doctor-appointment-types/:id",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseDoctorAppointmentType(req.body);
    const data = await updateDoctorAppointmentType(req.params.id, body.name);
    sendData(res, data, "Appointment type updated");
  }),
);

apiRouter.delete(
  "/doctor-appointment-types/:id",
  admin,
  asyncHandler(async (req, res) => {
    await deleteDoctorAppointmentType(req.params.id);
    sendData(res, null, "Appointment type deleted");
  }),
);

apiRouter.get(
  "/doctor-appointments",
  admin,
  asyncHandler(async (req, res) => {
    const query = parseDoctorListQuery(req.query as Record<string, unknown>);
    const data = await listDoctorAppointments(query);
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/doctor-appointments",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateDoctorAppointment(req.body);
    const data = await createDoctorAppointment(body);
    sendData(res, data, "Doctor appointment created");
  }),
);

apiRouter.get(
  "/doctor-appointments/client/:clientId",
  either,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await listDoctorAppointmentsForClient(
      context.user.id,
      req.params.clientId,
      context.user.role === "ADMIN" ? "any" : "assigned",
    );
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/doctor-appointments/:id",
  either,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await getDoctorAppointment(
      context.user.id,
      req.params.id,
      context.user.role === "ADMIN" ? "any" : "assigned",
    );
    sendData(res, data, "ok");
  }),
);

apiRouter.put(
  "/doctor-appointments/:id",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateDoctorAppointment(req.body);
    const data = await updateDoctorAppointment(req.params.id, body.present, body.value);
    sendData(res, data, "Doctor appointment updated");
  }),
);

apiRouter.delete(
  "/doctor-appointments/:id",
  admin,
  asyncHandler(async (req, res) => {
    await deleteDoctorAppointment(req.params.id);
    sendData(res, null, "Doctor appointment deleted");
  }),
);

apiRouter.post(
  "/appointments/:id/daily-completion/toggle",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    await requireOwnedAppointment(context.user.id, req.params.id);
    const body = parseDailyCompletion(req.body);
    const data = await completeDay(context.user.id, req.params.id, body.date, context.today);
    sendData(res, data, "Visit completed");
  }),
);

apiRouter.get(
  "/clients/caregiver/:caregiverId",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const query = parseClientListQuery(req.query as Record<string, unknown>);
    const data = await listClients(context.user.id, req.params.caregiverId, query);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/clients",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const query = parsePageQuery(req.query as Record<string, unknown>, 50);
    const data = await listClientsAdmin(query, context.today);
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/clients",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseCreateClient(req.body);
    const data = await createClient(context.user.id, body, context.today);
    sendData(res, data, "Client created");
  }),
);

apiRouter.get(
  "/clients/:clientId/hazards",
  admin,
  asyncHandler(async (req, res) => {
    const data = await listHazards(req.params.clientId);
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/clients/:clientId/hazards",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseHazard(req.body);
    const data = await createHazard(req.params.clientId, body);
    sendData(res, data, "Hazard created");
  }),
);

apiRouter.put(
  "/clients/:clientId/hazards/:hazardId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseHazard(req.body);
    const data = await updateHazard(req.params.clientId, req.params.hazardId, body);
    sendData(res, data, "Hazard updated");
  }),
);

apiRouter.delete(
  "/clients/:clientId/hazards/:hazardId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteHazard(req.params.clientId, req.params.hazardId);
    sendData(res, null, "Hazard deleted");
  }),
);

apiRouter.post(
  "/clients/:clientId/service-requirements",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseServiceRequirement(req.body);
    const data = await createServiceRequirement(req.params.clientId, body);
    sendData(res, data, "Service requirement created");
  }),
);

apiRouter.put(
  "/clients/:clientId/service-requirements/:requirementId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateServiceRequirement(req.body);
    const data = await updateServiceRequirement(req.params.clientId, req.params.requirementId, body.present, body.value);
    sendData(res, data, "Service requirement updated");
  }),
);

apiRouter.delete(
  "/clients/:clientId/service-requirements/:requirementId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteServiceRequirement(req.params.clientId, req.params.requirementId);
    sendData(res, null, "Service requirement deleted");
  }),
);

apiRouter.get(
  "/clients/:id",
  either,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await getClient(
      context.user.id,
      req.params.id,
      context.today,
      context.user.role === "ADMIN" ? "any" : "assigned",
    );
    sendData(res, data, "ok");
  }),
);

apiRouter.put(
  "/clients/:id",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseUpdateClient(req.body);
    const data = await updateClient(context.user.id, req.params.id, body.present, body.value, context.today);
    sendData(res, data, "Client updated");
  }),
);

apiRouter.delete(
  "/clients/:id",
  admin,
  asyncHandler(async (req, res) => {
    await deleteClient(req.params.id);
    sendData(res, null, "Client deleted");
  }),
);

apiRouter.post(
  "/care-plans",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateCarePlan(req.body);
    const data = await createCarePlan(body);
    sendData(res, data, "Care plan created");
  }),
);

apiRouter.put(
  "/care-plans/:carePlanId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateCarePlan(req.body);
    const data = await updateCarePlan(req.params.carePlanId, body.present, body.value);
    sendData(res, data, "Care plan updated");
  }),
);

apiRouter.delete(
  "/care-plans/:carePlanId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteCarePlan(req.params.carePlanId);
    sendData(res, null, "Care plan deleted");
  }),
);

apiRouter.post(
  "/care-plans/:carePlanId/tasks",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateTask(req.body);
    const data = await createTask(req.params.carePlanId, body);
    sendData(res, data, "Task created");
  }),
);

apiRouter.put(
  "/care-plans/:carePlanId/tasks/:taskId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateTask(req.body);
    const data = await updateTask(req.params.carePlanId, req.params.taskId, body.present, body.value);
    sendData(res, data, "Task updated");
  }),
);

apiRouter.delete(
  "/care-plans/:carePlanId/tasks/:taskId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteTask(req.params.carePlanId, req.params.taskId);
    sendData(res, null, "Task deleted");
  }),
);

apiRouter.post(
  "/care-plans/:carePlanId/medications",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateMedication(req.body);
    const data = await createMedication(req.params.carePlanId, body);
    sendData(res, data, "Medication created");
  }),
);

apiRouter.put(
  "/care-plans/:carePlanId/medications/:medicationId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateMedication(req.body);
    const data = await updateMedication(req.params.carePlanId, req.params.medicationId, body.present, body.value);
    sendData(res, data, "Medication updated");
  }),
);

apiRouter.delete(
  "/care-plans/:carePlanId/medications/:medicationId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteMedication(req.params.carePlanId, req.params.medicationId);
    sendData(res, null, "Medication deleted");
  }),
);

apiRouter.post(
  "/care-plans/:carePlanId/diet",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateDiet(req.body);
    const data = await createDiet(req.params.carePlanId, body);
    sendData(res, data, "Diet created");
  }),
);

apiRouter.put(
  "/care-plans/:carePlanId/diet/:dietId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateDiet(req.body);
    const data = await updateDiet(req.params.carePlanId, req.params.dietId, body.present, body.value);
    sendData(res, data, "Diet updated");
  }),
);

apiRouter.delete(
  "/care-plans/:carePlanId/diet/:dietId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteDiet(req.params.carePlanId, req.params.dietId);
    sendData(res, null, "Diet deleted");
  }),
);

apiRouter.post(
  "/care-plans/:carePlanId/hygiene",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateHygiene(req.body);
    const data = await createHygiene(req.params.carePlanId, body);
    sendData(res, data, "Hygiene created");
  }),
);

apiRouter.put(
  "/care-plans/:carePlanId/hygiene/:hygieneId",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseUpdateHygiene(req.body);
    const data = await updateHygiene(req.params.carePlanId, req.params.hygieneId, body.present, body.value);
    sendData(res, data, "Hygiene updated");
  }),
);

apiRouter.delete(
  "/care-plans/:carePlanId/hygiene/:hygieneId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteHygiene(req.params.carePlanId, req.params.hygieneId);
    sendData(res, null, "Hygiene deleted");
  }),
);

apiRouter.post(
  "/care-plans/:carePlanId/check-in",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    await requireOwnedCarePlan(context.user.id, req.params.carePlanId);
    const body = parseCheckIn(req.body);
    const data = await checkIn(context.user.id, req.params.carePlanId, body, context.today);
    sendData(res, data, "Checked in");
  }),
);

apiRouter.post(
  "/care-plans/:carePlanId/completions/toggle",
  caregiver,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    await requireOwnedCarePlan(context.user.id, req.params.carePlanId);
    const body = parseToggle(req.body);
    const completed = await toggleCompletion(context.user.id, req.params.carePlanId, body);
    sendData(res, { completed }, "Updated");
  }),
);

apiRouter.get(
  "/users/caregivers",
  admin,
  asyncHandler(async (req, res) => {
    const query = parsePageQuery(req.query as Record<string, unknown>, 100);
    const data = await listCaregivers(query);
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/users/caregivers",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateCaregiver(req.body);
    const data = await createCaregiver(body);
    sendData(res, data, "Caregiver created");
  }),
);

apiRouter.post(
  "/users/caregivers/:id/deactivate",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const data = await deactivateCaregiver(req.params.id, context.user.id);
    sendData(res, data, "Caregiver deactivated");
  }),
);

apiRouter.post(
  "/users/caregivers/:id/password",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCaregiverPassword(req.body);
    const data = await changeCaregiverPassword(req.params.id, body.password);
    sendData(res, data, "Password updated");
  }),
);

apiRouter.get(
  "/users/sales",
  admin,
  asyncHandler(async (req, res) => {
    const query = parsePageQuery(req.query as Record<string, unknown>, 100);
    const status = parseSalesListStatus(req.query as Record<string, unknown>);
    const data = await listSales(query, status);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/users/sales/:id",
  adminOrSales,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    sendData(res, await getSales(context.user, req.params.id), "ok");
  }),
);

apiRouter.post(
  "/users/sales",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCreateSales(req.body);
    const data = await createSales(body);
    sendData(res, data, "Sales account created");
  }),
);

apiRouter.post(
  "/users/sales/:id/deactivate",
  admin,
  asyncHandler(async (req, res) => {
    const data = await deactivateSales(req.params.id);
    sendData(res, data, "Sales account deactivated");
  }),
);

apiRouter.post(
  "/users/sales/:id/password",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseCaregiverPassword(req.body);
    const data = await changeSalesPassword(req.params.id, body.password);
    sendData(res, data, "Password updated");
  }),
);

apiRouter.post(
  "/users/sales/:id/sessions/revoke",
  admin,
  asyncHandler(async (req, res) => {
    const data = await revokeSalesSessions(req.params.id);
    sendData(res, data, "Session revoked");
  }),
);

apiRouter.get(
  "/users/caregivers/:id/availability",
  admin,
  asyncHandler(async (req, res) => {
    sendData(res, await getAvailability(req.params.id), "ok");
  }),
);

apiRouter.put(
  "/users/caregivers/:id/availability",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseAvailability(req.body);
    sendData(res, await replaceAvailability(req.params.id, body.windows), "Availability updated");
  }),
);

apiRouter.get(
  "/users/caregivers/:id/time-off",
  admin,
  asyncHandler(async (req, res) => {
    const range = parseOptionalDateRange(req.query as Record<string, unknown>);
    sendData(res, await listTimeOff(req.params.id, range), "ok");
  }),
);

apiRouter.post(
  "/users/caregivers/:id/time-off",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseTimeOff(req.body);
    sendData(res, await createTimeOff(req.params.id, body), "Time off added");
  }),
);

apiRouter.delete(
  "/users/caregivers/:id/time-off/:timeOffId",
  admin,
  asyncHandler(async (req, res) => {
    await deleteTimeOff(req.params.id, req.params.timeOffId);
    sendData(res, null, "Time off removed");
  }),
);

apiRouter.get(
  "/caregiver-positions",
  admin,
  asyncHandler(async (_req, res) => {
    const data = await listPositions();
    sendData(res, data, "ok");
  }),
);

apiRouter.post(
  "/caregiver-positions",
  admin,
  asyncHandler(async (req, res) => {
    const body = parsePosition(req.body);
    const data = await createPosition(body.name);
    sendData(res, data, "Position created");
  }),
);

apiRouter.put(
  "/caregiver-positions/:id",
  admin,
  asyncHandler(async (req, res) => {
    const body = parsePosition(req.body);
    const data = await updatePosition(req.params.id, body.name);
    sendData(res, data, "Position updated");
  }),
);

apiRouter.delete(
  "/caregiver-positions/:id",
  admin,
  asyncHandler(async (req, res) => {
    await deletePosition(req.params.id);
    sendData(res, null, "Position deleted");
  }),
);

apiRouter.get(
  "/services",
  admin,
  asyncHandler(async (_req, res) => {
    sendData(res, await listServices(), "ok");
  }),
);

apiRouter.post(
  "/services",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseServiceName(req.body);
    const data = await createService(body.name);
    sendData(res, data, "Service created");
  }),
);

apiRouter.put(
  "/services/:id",
  admin,
  asyncHandler(async (req, res) => {
    const body = parseServiceName(req.body);
    const data = await updateService(req.params.id, body.name);
    sendData(res, data, "Service updated");
  }),
);

apiRouter.delete(
  "/services/:id",
  admin,
  asyncHandler(async (req, res) => {
    await deleteService(req.params.id);
    sendData(res, null, "Service deleted");
  }),
);

apiRouter.get(
  "/admin/reports/visits",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const page = parsePageQuery(req.query as Record<string, unknown>, 20);
    const filters = parseReportFilters(req.query as Record<string, unknown>, context.today);
    const data = await visitReport(filters, page.page, page.pageSize, context.timeZone, context.today);
    sendData(res, data, "ok");
  }),
);

apiRouter.get(
  "/admin/reports/visits/export.pdf",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const filters = parseReportFilters(req.query as Record<string, unknown>, context.today);
    const pdf = await visitReportPdf(filters, context.timeZone, context.today);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdf.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf.buffer);
  }),
);

apiRouter.post(
  "/admin/reports/visits/:dailyVisitId/hours",
  admin,
  asyncHandler(async (req, res) => {
    const context = getRequestContext(req);
    const body = parseHourAdjustment(req.body);
    const data = await adjustVisitHours(
      context.user.id,
      req.params.dailyVisitId,
      body,
      context.timeZone,
      context.today,
    );
    sendData(res, data, "Hours corrected");
  }),
);

apiRouter.use(
  "/admin",
  requireRoles(["ADMIN"]),
  (_req, res) => {
    res.status(404).json(errorBody("The requested resource was not found.", "NOT_FOUND"));
  },
);

function salesActor(req: Request): SalesActor {
  const context = getRequestContext(req);
  if (context.user.role !== "ADMIN" && context.user.role !== "SALES") {
    throw forbidden();
  }
  return { id: context.user.id, role: context.user.role };
}
