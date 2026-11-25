import dotenv from "dotenv";
import { INTEGRATION_NAMES, type IntegrationName } from "./integrations/types";

dotenv.config();

function required(name: string, minimumLength = 1): string {
  const value = process.env[name];
  if (!value || value.trim().length < minimumLength) {
    throw new Error(
      `Missing or too-short environment variable ${name}. Copy .env.example to .env and set a real value.`,
    );
  }
  return value;
}

const corsRaw = process.env.CORS_ORIGINS ?? "";

const KNOWN_EXAMPLE_SECRETS = new Set([
  "replace-with-a-random-string-at-least-32-characters",
  "replace-with-a-different-random-string-at-least-32-characters",
  "test-jwt-secret-must-be-32-characters-long",
  "test-refresh-pepper-must-be-32-characters",
]);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", 32),
  refreshTokenPepper: required("REFRESH_TOKEN_PEPPER", 32),
  corsOrigins: corsRaw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
};

if (config.nodeEnv === "production") {
  if (KNOWN_EXAMPLE_SECRETS.has(config.jwtSecret) || KNOWN_EXAMPLE_SECRETS.has(config.refreshTokenPepper)) {
    throw new Error(
      "Refusing to start in production because JWT_SECRET or REFRESH_TOKEN_PEPPER is an example value.",
    );
  }
  if (config.jwtSecret === config.refreshTokenPepper) {
    throw new Error(
      "Refusing to start in production because JWT_SECRET and REFRESH_TOKEN_PEPPER must be different.",
    );
  }
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

type IntegrationEnvSpec = {
  flag: string;
  required: readonly string[];
  optional: readonly string[];
};

/** Env var names only. Values are read on demand and are never logged. */
export const integrationEnv: Record<IntegrationName, IntegrationEnvSpec> = {
  meta: {
    flag: "META_LEADS_ENABLED",
    required: [
      "META_APP_ID",
      "META_APP_SECRET",
      "META_PAGE_ID",
      "META_PAGE_ACCESS_TOKEN",
      "META_WEBHOOK_VERIFY_TOKEN",
    ],
    optional: ["META_GRAPH_API_VERSION", "META_LEAD_FIELD_MAP", "META_LEAD_FIELD_MAP_FILE"],
  },
  ringcentral: {
    flag: "RINGCENTRAL_ENABLED",
    required: [
      "RINGCENTRAL_CLIENT_ID",
      "RINGCENTRAL_CLIENT_SECRET",
      "RINGCENTRAL_SERVER_URL",
      "RINGCENTRAL_JWT",
      "RINGCENTRAL_ACCOUNT_ID",
      "RINGCENTRAL_EXTENSION_ID",
      "RINGCENTRAL_FROM_NUMBER",
    ],
    optional: ["RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN"],
  },
  zoho: {
    flag: "ZOHO_ENABLED",
    required: [
      "ZOHO_CLIENT_ID",
      "ZOHO_CLIENT_SECRET",
      "ZOHO_REFRESH_TOKEN",
      "ZOHO_ACCOUNTS_DOMAIN",
      "ZOHO_API_DOMAIN",
    ],
    optional: [
      "ZOHO_CRM_MODULE",
      "ZOHO_INBOUND_ENABLED",
      "ZOHO_OUTBOUND_ENABLED",
      "ZOHO_WEBHOOK_SECRET",
      "ZOHO_LEAD_MAP",
      "ZOHO_LEAD_MAP_FILE",
    ],
  },
  outlook: {
    flag: "OUTLOOK_ENABLED",
    required: ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT_ID", "OUTLOOK_CALENDAR_USER"],
    optional: [],
  },
};

/**
 * When an OUTLOOK_ value is empty, the matching MICROSOFT_ name is read.
 * OUTLOOK_ wins when both are set.
 */
const INTEGRATION_ENV_ALIASES: Record<string, string> = {
  OUTLOOK_ENABLED: "MICROSOFT_ENABLED",
  OUTLOOK_CLIENT_ID: "MICROSOFT_CLIENT_ID",
  OUTLOOK_CLIENT_SECRET: "MICROSOFT_CLIENT_SECRET",
  OUTLOOK_TENANT_ID: "MICROSOFT_TENANT_ID",
  OUTLOOK_CALENDAR_USER: "MICROSOFT_CALENDAR_USER",
};

function readEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length > 0) {
    return value;
  }
  const alias = INTEGRATION_ENV_ALIASES[name];
  return alias ? (process.env[alias] ?? "").trim() : "";
}

export type IntegrationEnvState = {
  flagEnabled: boolean;
  configured: boolean;
  enabled: boolean;
};

export function readIntegrationEnv(name: IntegrationName): IntegrationEnvState {
  const spec = integrationEnv[name];
  const flagEnabled = readEnv(spec.flag).toLowerCase() === "true";
  const configured = spec.required.every((key) => readEnv(key).length > 0);
  return {
    flagEnabled,
    configured,
    enabled: flagEnabled && configured,
  };
}

/** Credential map. Do not log the returned values. */
export function integrationCredentialValues(name: IntegrationName): Record<string, string> {
  const spec = integrationEnv[name];
  const values: Record<string, string> = {};
  for (const key of [...spec.required, ...spec.optional]) {
    values[key] = readEnv(key);
  }
  return values;
}

export function integrationEnvKeys(): string[] {
  const keys = new Set<string>();
  for (const name of INTEGRATION_NAMES) {
    const spec = integrationEnv[name];
    keys.add(spec.flag);
    for (const key of [...spec.required, ...spec.optional]) {
      keys.add(key);
    }
  }
  for (const alias of Object.values(INTEGRATION_ENV_ALIASES)) {
    keys.add(alias);
  }
  return [...keys];
}
