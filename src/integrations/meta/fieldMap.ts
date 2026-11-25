import { readFileSync } from "node:fs";
import { integrationCredentialValues } from "../../config";
import { logWarn } from "../../lib/logger";

export type MetaFieldMap = {
  firstName: string[];
  lastName: string[];
  fullName: string[];
  email: string[];
  phone: string[];
  platform: string[];
};

const MAP_KEYS = ["firstName", "lastName", "fullName", "email", "phone", "platform"] as const;

export const DEFAULT_META_FIELD_MAP: MetaFieldMap = {
  firstName: ["first_name", "first name"],
  lastName: ["last_name", "last name"],
  fullName: ["full_name", "full name", "name"],
  email: ["email", "email_address"],
  phone: ["phone_number", "phone", "mobile"],
  platform: ["platform"],
};

export function metaLeadFieldMap(): MetaFieldMap {
  const creds = integrationCredentialValues("meta");
  const rawEnv = (creds.META_LEAD_FIELD_MAP ?? "").trim();
  if (rawEnv) {
    const fromEnv = parseFieldMap(rawEnv);
    return fromEnv ? { ...DEFAULT_META_FIELD_MAP, ...fromEnv } : DEFAULT_META_FIELD_MAP;
  }
  const file = (creds.META_LEAD_FIELD_MAP_FILE ?? "").trim();
  if (!file) {
    return DEFAULT_META_FIELD_MAP;
  }
  try {
    const fromFile = parseFieldMap(readFileSync(file, "utf8"));
    if (fromFile) {
      return { ...DEFAULT_META_FIELD_MAP, ...fromFile };
    }
  } catch {
    logWarn("meta lead field map file could not be read; using the default map", { integration: "meta" });
  }
  return DEFAULT_META_FIELD_MAP;
}

function parseFieldMap(raw: string): Partial<MetaFieldMap> | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    logWarn("meta lead field map is not valid JSON; using the default map", { integration: "meta" });
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    logWarn("meta lead field map must be a JSON object; using the default map", { integration: "meta" });
    return null;
  }
  const parsed: Partial<MetaFieldMap> = {};
  for (const key of MAP_KEYS) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry === undefined) {
      continue;
    }
    if (!Array.isArray(entry) || entry.length === 0 || entry.some((item) => typeof item !== "string" || item.trim() === "")) {
      logWarn("meta lead field map has an invalid alias list; using the default map", { integration: "meta" });
      return null;
    }
    parsed[key] = entry.map((item) => item.trim());
  }
  return parsed;
}
