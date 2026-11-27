import type { Router } from "express";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CALL_DIRECTIONS,
  CALL_RESULTS,
  LEAD_SOURCES,
  LEAD_STAGES,
  NOTE_OUTCOMES,
  QUEUE_FILTERS,
} from "../domain/sales";
import { apiRouter } from "../routes/api";
import { accountDeletionRequestSchema } from "../validation/accountDeletion";
import {
  cancelAppointmentSchema,
  createAppointmentSchema,
  dailyCompletionSchema,
  updateAppointmentSchema,
} from "../validation/appointments";
import {
  caregiverAccountSchema,
  caregiverPasswordSchema,
  forgotSchema,
  loginSchema,
  positionSchema,
  refreshSchema,
  resetSchema,
  salesAccountSchema,
} from "../validation/auth";
import { createCallSchema } from "../validation/calls";
import {
  carePlanDietSchema,
  carePlanHygieneSchema,
  carePlanMedicationSchema,
  carePlanSchema,
  carePlanTaskSchema,
  carePlanToggleSchema,
  checkInSchema,
} from "../validation/carePlans";
import {
  createClientSchema,
  hazardSchema,
  serviceRequirementSchema,
  updateClientSchema,
} from "../validation/clients";
import { coverageReasonSchema } from "../validation/coverage";
import { registerDeviceSchema, removeDeviceSchema } from "../validation/devices";
import {
  doctorAppointmentCreateSchema,
  doctorAppointmentTypeSchema,
  doctorAppointmentUpdateSchema,
} from "../validation/doctorAppointments";
import { assignLeadSchema, createLeadSchema, leadNoteSchema, leadStageBodySchema, updateLeadSchema } from "../validation/leads";
import { createMeetingSchema, updateMeetingSchema } from "../validation/meetings";
import { hourAdjustmentSchema } from "../validation/reports";
import { availabilitySchema, createSeriesSchema, timeOffSchema, updateSeriesSchema } from "../validation/schedule";
import { serviceNameSchema } from "../validation/services";

const API_PREFIX = "/api/v1";

type JsonSchema = Record<string, unknown>;

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name?: string } }>;
  };
};

export type ApiRoute = {
  method: string;
  path: string;
  roles: string[] | null;
};

type BodyDoc = {
  zod?: ZodTypeAny;
  schema?: JsonSchema;
  required?: boolean;
  description?: string;
};

type QueryDoc = {
  name: string;
  required?: boolean;
  description?: string;
  schema: JsonSchema;
};

const dateSchema: JsonSchema = { type: "string", format: "date", example: "2026-11-27" };
const uuidSchema: JsonSchema = { type: "string", format: "uuid" };
const offsetSchema: JsonSchema = { type: "string", example: "-08:00", description: "+HH:mm or -HH:mm" };

const pageQuery: QueryDoc[] = [
  { name: "page", schema: { type: "integer", minimum: 1, default: 1 }, description: "Page number, starting at 1." },
  { name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size. Maximum 100." },
  { name: "search", schema: { type: "string", maxLength: 100 }, description: "Optional search text." },
];

const offsetQuery: QueryDoc = {
  name: "timeZoneOffset",
  schema: offsetSchema,
  description: "Client offset used for the request's calendar day. Example: -08:00.",
};

function jsonSchema(schema: ZodTypeAny): JsonSchema {
  const converted = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as JsonSchema;
  delete converted.$schema;
  return converted;
}

function rolesFrom(stack: Array<{ handle: { name?: string } }>): string[] | null {
  for (const layer of stack) {
    const name = layer.handle.name ?? "";
    if (name.startsWith("auth:")) {
      return name.slice("auth:".length).split(",").filter((role) => role.length > 0);
    }
  }
  return null;
}

export function collectApiRoutes(router: Router = apiRouter): ApiRoute[] {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const routes: ApiRoute[] = [];
  for (const layer of stack) {
    if (!layer.route) {
      continue;
    }
    const roles = rolesFrom(layer.route.stack);
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (!enabled || method.toUpperCase() === "HEAD") {
        continue;
      }
      routes.push({ method: method.toUpperCase(), path: layer.route.path, roles });
    }
  }
  routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  return routes;
}

const updateServiceRequirementSchema = serviceRequirementSchema.partial().strict();

const requestBodies: Record<string, BodyDoc> = {
  "POST /auth/login": { zod: loginSchema, description: "role, when sent, must be CAREGIVER." },
  "POST /auth/refresh": { zod: refreshSchema },
  "POST /auth/forgot-password": { zod: forgotSchema },
  "POST /auth/reset-password": { zod: resetSchema },
  "POST /admin/auth/login": { zod: loginSchema, description: "Administrator sign-in. role is ignored." },
  "POST /auth/account-deletion": { zod: accountDeletionRequestSchema, required: false },
  "POST /sales/meetings": { zod: createMeetingSchema },
  "PATCH /sales/meetings/:id": { zod: updateMeetingSchema },
  "POST /leads": { zod: createLeadSchema },
  "PATCH /leads/:id": { zod: updateLeadSchema },
  "PATCH /leads/:id/stage": { zod: leadStageBodySchema },
  "POST /leads/:id/assign": { zod: assignLeadSchema },
  "POST /calls": { zod: createCallSchema },
  "POST /leads/:id/notes": { zod: leadNoteSchema },
  "POST /appointments": { zod: createAppointmentSchema },
  "PUT /appointments/:id": {
    schema: { oneOf: [jsonSchema(cancelAppointmentSchema), jsonSchema(updateAppointmentSchema)] },
    description:
      "A caregiver cancels the visit: appointmentStatus must be cancelled and cancellationReason is required. An administrator updates appointment fields.",
  },
  "POST /appointments/:id/coverage": { zod: coverageReasonSchema },
  "POST /notification-devices": { zod: registerDeviceSchema },
  "DELETE /notification-devices": { zod: removeDeviceSchema },
  "POST /visit-series": { zod: createSeriesSchema },
  "PUT /visit-series/:id": { zod: updateSeriesSchema },
  "POST /doctor-appointment-types": { zod: doctorAppointmentTypeSchema },
  "PUT /doctor-appointment-types/:id": { zod: doctorAppointmentTypeSchema },
  "POST /doctor-appointments": { zod: doctorAppointmentCreateSchema },
  "PUT /doctor-appointments/:id": { zod: doctorAppointmentUpdateSchema },
  "POST /appointments/:id/daily-completion/toggle": { zod: dailyCompletionSchema },
  "POST /clients": { zod: createClientSchema },
  "POST /clients/:clientId/hazards": { zod: hazardSchema },
  "PUT /clients/:clientId/hazards/:hazardId": { zod: hazardSchema },
  "POST /clients/:clientId/service-requirements": { zod: serviceRequirementSchema },
  "PUT /clients/:clientId/service-requirements/:requirementId": { zod: updateServiceRequirementSchema },
  "PUT /clients/:id": { zod: updateClientSchema },
  "POST /care-plans": { zod: carePlanSchema },
  "PUT /care-plans/:carePlanId": { zod: carePlanSchema },
  "POST /care-plans/:carePlanId/tasks": { zod: carePlanTaskSchema },
  "PUT /care-plans/:carePlanId/tasks/:taskId": { zod: carePlanTaskSchema },
  "POST /care-plans/:carePlanId/medications": { zod: carePlanMedicationSchema },
  "PUT /care-plans/:carePlanId/medications/:medicationId": { zod: carePlanMedicationSchema },
  "POST /care-plans/:carePlanId/diet": { zod: carePlanDietSchema },
  "PUT /care-plans/:carePlanId/diet/:dietId": { zod: carePlanDietSchema },
  "POST /care-plans/:carePlanId/hygiene": { zod: carePlanHygieneSchema },
  "PUT /care-plans/:carePlanId/hygiene/:hygieneId": { zod: carePlanHygieneSchema },
  "POST /care-plans/:carePlanId/check-in": { zod: checkInSchema },
  "POST /care-plans/:carePlanId/completions/toggle": { zod: carePlanToggleSchema },
  "POST /users/caregivers": { zod: caregiverAccountSchema },
  "POST /users/caregivers/:id/password": { zod: caregiverPasswordSchema },
  "POST /users/sales": { zod: salesAccountSchema },
  "POST /users/sales/:id/password": { zod: caregiverPasswordSchema },
  "PUT /users/caregivers/:id/availability": { zod: availabilitySchema },
  "POST /users/caregivers/:id/time-off": { zod: timeOffSchema },
  "POST /caregiver-positions": { zod: positionSchema },
  "PUT /caregiver-positions/:id": { zod: positionSchema },
  "POST /services": { zod: serviceNameSchema },
  "PUT /services/:id": { zod: serviceNameSchema },
  "POST /admin/reports/visits/:dailyVisitId/hours": { zod: hourAdjustmentSchema },
  "POST /webhooks/meta/leads": {
    schema: { type: "object", additionalProperties: true },
    description: "Meta leadgen webhook payload. Signed with X-Hub-Signature-256 when the app secret is set.",
  },
  "POST /webhooks/zoho/leads": {
    schema: { type: "object", additionalProperties: true },
    description: "Zoho CRM lead payload. Requires the x-zoho-webhook-secret header.",
  },
  "POST /webhooks/ringcentral/calls": {
    schema: { type: "object", additionalProperties: true },
    description: "RingCentral telephony payload. A Validation-Token header is echoed for the subscription handshake.",
  },
};

const queryDocs: Record<string, QueryDoc[]> = {
  "GET /account-deletion-requests": [
    ...pageQuery,
    {
      name: "status",
      schema: { type: "string", enum: ["pending", "approved", "rejected"], default: "pending" },
    },
  ],
  "GET /salespeople": [
    { name: "status", schema: { type: "string", enum: ["active", "inactive", "all"], default: "all" } },
  ],
  "GET /salespeople/:id": [offsetQuery],
  "GET /sales/meetings": [
    { name: "from", required: true, schema: dateSchema },
    { name: "to", required: true, schema: dateSchema, description: "On or after from." },
    { name: "ownerId", schema: uuidSchema },
    offsetQuery,
  ],
  "GET /leads/queues/summary": [offsetQuery, { name: "ownerId", schema: uuidSchema }],
  "GET /leads": [
    ...pageQuery,
    { name: "stage", schema: { type: "string", enum: [...LEAD_STAGES] } },
    { name: "ownerId", schema: uuidSchema },
    { name: "queue", schema: { type: "string", enum: [...QUEUE_FILTERS] } },
    offsetQuery,
  ],
  "POST /leads": [offsetQuery],
  "GET /leads/:id": [offsetQuery],
  "PATCH /leads/:id": [offsetQuery],
  "PATCH /leads/:id/stage": [offsetQuery],
  "POST /leads/:id/assign": [offsetQuery],
  "POST /leads/:id/notes": [offsetQuery],
  "GET /calls": [
    ...pageQuery,
    { name: "from", schema: { type: "string" }, description: "YYYY-MM-DD or an ISO datetime with an offset." },
    { name: "to", schema: { type: "string" }, description: "YYYY-MM-DD or an ISO datetime with an offset." },
    { name: "ownerId", schema: uuidSchema },
    { name: "leadId", schema: uuidSchema },
    { name: "result", schema: { type: "string", enum: [...CALL_RESULTS] } },
    { name: "direction", schema: { type: "string", enum: [...CALL_DIRECTIONS] } },
    offsetQuery,
  ],
  "GET /dashboard/stats": [offsetQuery],
  "GET /appointments": pageQuery,
  "GET /notifications": [
    { name: "unread", schema: { type: "boolean" }, description: "true returns unread notifications only." },
  ],
  "GET /schedule": [
    { name: "from", required: true, schema: dateSchema },
    { name: "to", required: true, schema: dateSchema, description: "At most 31 days after from." },
    {
      name: "caregiverIds",
      schema: { type: "string" },
      description: "Comma-separated caregiver ids. At most 50.",
    },
  ],
  "GET /schedule/summary": [
    { name: "month", required: true, schema: { type: "string", example: "2026-11" }, description: "YYYY-MM." },
    {
      name: "caregiverIds",
      schema: { type: "string" },
      description: "Comma-separated caregiver ids. At most 50.",
    },
  ],
  "GET /visit-series": [
    { name: "caregiverId", schema: uuidSchema },
    { name: "clientId", schema: uuidSchema },
    { name: "status", schema: { type: "string", enum: ["active", "ended"] } },
  ],
  "DELETE /visit-series/:id": [
    { name: "fromDate", schema: dateSchema, description: "End the series from this date." },
  ],
  "GET /doctor-appointments": [
    ...pageQuery,
    { name: "clientId", schema: uuidSchema },
    { name: "status", schema: { type: "string", enum: ["scheduled", "completed", "cancelled"] } },
  ],
  "GET /clients/caregiver/:caregiverId": [
    { name: "page", required: true, schema: { type: "integer", minimum: 1 } },
    { name: "pageSize", required: true, schema: { type: "integer", minimum: 1, maximum: 100 } },
    { name: "status", required: true, schema: { type: "string", enum: ["active", "inactive"] } },
    { name: "search", schema: { type: "string", maxLength: 100 } },
  ],
  "GET /clients": pageQuery,
  "GET /users/caregivers": pageQuery,
  "GET /users/sales": [
    ...pageQuery,
    { name: "status", schema: { type: "string", enum: ["active", "inactive", "all"], default: "all" } },
  ],
  "GET /users/caregivers/:id/time-off": [
    { name: "from", schema: dateSchema },
    { name: "to", schema: dateSchema },
  ],
  "GET /admin/reports/visits": [...reportFilters(), ...pageQuery],
  "GET /admin/reports/visits/export.pdf": reportFilters(),
  "GET /webhooks/meta/leads": [
    { name: "hub.mode", required: true, schema: { type: "string", example: "subscribe" } },
    { name: "hub.verify_token", required: true, schema: { type: "string" } },
    { name: "hub.challenge", required: true, schema: { type: "string" } },
  ],
};

function reportFilters(): QueryDoc[] {
  return [
    {
      name: "period",
      schema: { type: "string", enum: ["daily", "weekly", "monthly", "custom"], default: "daily" },
    },
    {
      name: "status",
      schema: { type: "string", enum: ["completed", "pending", "missed", "cancelled", "all"], default: "completed" },
    },
    { name: "date", schema: dateSchema, description: "Anchor date for daily, weekly, and monthly periods." },
    { name: "from", schema: dateSchema, description: "Required when period is custom." },
    { name: "to", schema: dateSchema, description: "Required when period is custom. At most 366 days." },
    { name: "caregiverId", schema: uuidSchema },
    { name: "clientId", schema: uuidSchema },
  ];
}

const createdRoutes = new Set(["POST /sales/meetings", "POST /leads", "POST /calls"]);

const summaries: Record<string, string> = {
  "GET /health": "Database health check",
  "POST /auth/login": "Sign in as a caregiver",
  "POST /auth/refresh": "Rotate the access and refresh tokens",
  "POST /auth/forgot-password": "Start a password reset",
  "POST /auth/reset-password": "Set a new password from a reset token",
  "POST /admin/auth/login": "Sign in as an administrator",
  "POST /auth/logout": "Sign out and revoke the current session",
  "POST /auth/account-deletion": "Request deletion of the signed-in caregiver account",
  "GET /webhooks/meta/leads": "Verify the Meta lead webhook",
  "POST /webhooks/meta/leads": "Receive Meta lead ads",
  "POST /webhooks/zoho/leads": "Receive Zoho CRM leads",
  "POST /webhooks/ringcentral/calls": "Receive RingCentral call events",
  "GET /integrations/status": "Integration configuration status",
  "GET /sales/dashboard": "Sales dashboard for the signed-in salesperson",
  "GET /sales/assignment-state": "Lead assignment counters",
  "GET /leads/queues/summary": "Lead queue counts",
  "POST /leads/:id/calls/start": "Start a RingCentral call for a lead",
  "POST /sales/meetings/:id/outlook": "Save the meeting on Outlook",
  "GET /appointments/caregiver/:caregiverId": "Visits assigned to the signed-in caregiver",
  "GET /appointments/types": "Appointment type values",
  "POST /appointments/:id/coverage": "Offer a visit to other caregivers",
  "POST /appointments/:id/coverage/withdraw": "Withdraw an open coverage offer",
  "GET /appointment-coverage/open": "Open coverage offers from other caregivers",
  "GET /appointment-coverage/mine": "The caller's open coverage offers",
  "POST /appointment-coverage/:id/accept": "Accept a coverage offer",
  "POST /appointments/:id/daily-completion/toggle": "Mark one visit day complete",
  "POST /care-plans/:carePlanId/check-in": "Check in to a care plan",
  "POST /care-plans/:carePlanId/completions/toggle": "Toggle a care-plan item for a date",
  "POST /notifications/read-all": "Mark every notification read",
  "POST /notifications/:id/read": "Mark one notification read",
  "GET /admin/reports/visits/export.pdf": "Download the visit report as a PDF",
  "POST /admin/reports/visits/:dailyVisitId/hours": "Correct recorded visit hours",
  "POST /users/sales/:id/sessions/revoke": "Revoke a salesperson's sessions",
};

function summaryFor(method: string, path: string): string {
  const custom = summaries[`${method} ${path}`];
  if (custom) {
    return custom;
  }
  const parts = path.split("/").filter((part) => part.length > 0 && !part.startsWith(":"));
  const resource = (parts[parts.length - 1] ?? path).replace(/-/g, " ");
  if (method === "GET") {
    return `Get ${resource}`;
  }
  if (method === "POST") {
    return `Create ${resource}`;
  }
  if (method === "DELETE") {
    return `Delete ${resource}`;
  }
  return `Update ${resource}`;
}

function tagFor(fullPath: string): string {
  if (fullPath === "/health") {
    return "Health";
  }
  const segment = fullPath.slice(API_PREFIX.length).split("/").filter(Boolean)[0] ?? "Other";
  const labels: Record<string, string> = {
    auth: "Auth",
    admin: "Admin",
    webhooks: "Webhooks",
    "account-deletion-requests": "Account deletion",
    salespeople: "Sales",
    sales: "Sales",
    integrations: "Integrations",
    leads: "Leads",
    calls: "Calls",
    dashboard: "Dashboard",
    appointments: "Appointments",
    "appointment-coverage": "Coverage",
    notifications: "Notifications",
    "notification-devices": "Notifications",
    schedule: "Schedule",
    "visit-series": "Schedule",
    "doctor-appointment-types": "Doctor appointments",
    "doctor-appointments": "Doctor appointments",
    clients: "Clients",
    "care-plans": "Care plans",
    users: "Users",
    "caregiver-positions": "Caregivers",
    services: "Services",
  };
  return labels[segment] ?? segment;
}

function pathParameters(openApiPath: string): Array<Record<string, unknown>> {
  const names = [...openApiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  return names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: name === "id" || name.endsWith("Id") ? uuidSchema : { type: "string" },
  }));
}

function toOpenApiPath(routePath: string): string {
  return `${API_PREFIX}${routePath}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

const envelopeSchema: JsonSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    message: { type: "string" },
    data: {},
    timestamp: { type: "string", format: "date-time" },
    requestId: { type: "string", format: "uuid" },
  },
  required: ["success", "message", "data", "timestamp", "requestId"],
};

const errorSchema: JsonSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    code: { type: "string" },
    errors: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
  },
};

function operationFor(route: ApiRoute): Record<string, unknown> {
  const key = `${route.method} ${route.path}`;
  const openPath = route.path === "/health" ? "/health" : toOpenApiPath(route.path);
  const body = requestBodies[key];
  const query = queryDocs[key] ?? [];
  const headerParams: Array<Record<string, unknown>> = [];
  if (route.path.startsWith("/webhooks/zoho")) {
    headerParams.push({
      name: "x-zoho-webhook-secret",
      in: "header",
      required: true,
      schema: { type: "string" },
    });
  }
  if (route.path === "/webhooks/meta/leads" && route.method === "POST") {
    headerParams.push({
      name: "X-Hub-Signature-256",
      in: "header",
      required: false,
      schema: { type: "string" },
      description: "sha256 HMAC of the raw body when META_APP_SECRET is set.",
    });
  }
  if (route.path === "/webhooks/ringcentral/calls") {
    headerParams.push(
      {
        name: "Verification-Token",
        in: "header",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "Validation-Token",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "Present only for the RingCentral subscription handshake.",
      },
    );
  }
  if (!route.path.startsWith("/webhooks")) {
    headerParams.push({
      name: "X-Timezone",
      in: "header",
      required: false,
      schema: { type: "string", example: "America/Vancouver" },
      description: "IANA timezone for calendar-day calculations. Defaults to America/Vancouver.",
    });
  }

  const successStatus = createdRoutes.has(key) ? "201" : "200";
  const responses: Record<string, unknown> = {};
  if (key === "GET /admin/reports/visits/export.pdf") {
    responses["200"] = {
      description: "PDF file",
      content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
    };
  } else if (key === "GET /webhooks/meta/leads") {
    responses["200"] = {
      description: "Plain-text hub challenge",
      content: { "text/plain": { schema: { type: "string" } } },
    };
  } else if (route.path.startsWith("/webhooks")) {
    responses["200"] = {
      description: "Webhook acknowledgement",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              received: { type: "boolean" },
              results: { type: "array", items: { type: "object" } },
            },
          },
        },
      },
    };
  } else if (route.path === "/health") {
    responses["200"] = {
      description: "Database is reachable",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              status: { type: "string", example: "ok" },
              database: { type: "string", example: "up" },
            },
          },
        },
      },
    };
    responses["503"] = { description: "Database is down" };
  } else {
    responses[successStatus] = {
      description: successStatus === "201" ? "Created" : "Success",
      content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" } } },
    };
  }
  if (route.roles) {
    responses["401"] = { description: "Missing, expired, or revoked access token" };
    responses["403"] = { description: `Requires one of: ${route.roles.join(", ")}` };
  }
  if (body) {
    responses["422"] = {
      description: "Validation failed",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } },
    };
  }

  const operation: Record<string, unknown> = {
    tags: [tagFor(openPath)],
    summary: summaryFor(route.method, route.path),
    operationId: `${route.method.toLowerCase()}_${openPath.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    parameters: [...pathParameters(openPath), ...query.map(toParameter), ...headerParams],
    responses,
  };
  if (route.roles) {
    operation.security = [{ bearerAuth: [] }];
    operation.description = `Allowed roles: ${route.roles.join(", ")}.`;
  } else {
    operation.security = [];
    operation.description = "No access token.";
  }
  if (body?.description) {
    operation.description = `${operation.description} ${body.description}`;
  }
  if (body) {
    operation.requestBody = {
      required: body.required !== false,
      content: {
        "application/json": {
          schema: body.schema ?? (body.zod ? jsonSchema(body.zod) : { type: "object" }),
        },
      },
    };
  }
  return operation;
}

function toParameter(query: QueryDoc): Record<string, unknown> {
  return {
    name: query.name,
    in: "query",
    required: query.required === true,
    description: query.description,
    schema: query.schema,
  };
}

export function openApiDocument(router: Router = apiRouter): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const routes: ApiRoute[] = [{ method: "GET", path: "/health", roles: null }, ...collectApiRoutes(router)];

  for (const route of routes) {
    const openPath = route.path === "/health" ? "/health" : toOpenApiPath(route.path);
    const methods = (paths[openPath] ??= {});
    methods[route.method.toLowerCase()] = operationFor(route);
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Senoria API",
      version: "1.0.0",
      description:
        "Caregiver, administrator, and sales APIs. Authenticated calls send Authorization: Bearer <accessToken>. Successful JSON calls use the SuccessEnvelope. This document is generated from the registered routes and the Zod request schemas.",
    },
    servers: [{ url: "/", description: "This server" }],
    tags: [
      "Health",
      "Auth",
      "Account deletion",
      "Webhooks",
      "Integrations",
      "Sales",
      "Leads",
      "Calls",
      "Dashboard",
      "Appointments",
      "Coverage",
      "Notifications",
      "Schedule",
      "Doctor appointments",
      "Clients",
      "Care plans",
      "Users",
      "Caregivers",
      "Services",
      "Admin",
    ].map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token from login or refresh. Expires after 24 hours.",
        },
      },
      schemas: {
        SuccessEnvelope: envelopeSchema,
        ErrorBody: errorSchema,
        LeadStage: { type: "string", enum: [...LEAD_STAGES] },
        LeadSource: { type: "string", enum: [...LEAD_SOURCES] },
        NoteOutcome: { type: "string", enum: [...NOTE_OUTCOMES] },
      },
    },
    paths,
  };
}
