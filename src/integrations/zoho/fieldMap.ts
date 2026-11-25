import { readFileSync } from "node:fs";
import path from "node:path";
import { LEAD_SOURCES, LEAD_STAGES, type LeadSource, type LeadStage } from "../../domain/sales";
import { logWarn } from "../../lib/logger";

export type ZohoLeadMaps = {
  source: Record<string, LeadSource>;
  stage: Record<string, LeadStage>;
  sourceDefault: LeadSource;
  stageDefault: LeadStage;
};

export const DEFAULT_ZOHO_LEAD_MAPS: ZohoLeadMaps = {
  source: {
    Facebook: "Facebook",
    "X (Twitter)": "Instagram",
    "Cold Call": "Phone",
    Chat: "Phone",
    "Sales Email Alias": "Phone",
    "Employee Referral": "Referral",
    "External Referral": "Referral",
    Partner: "Referral",
    "Seminar Partner": "Referral",
    "Internal Seminar": "Referral",
    "Trade Show": "Referral",
    Advertisement: "Referral",
    "Online Store": "Referral",
    "Public Relations": "Referral",
    "Web Download": "Referral",
    "Web Research": "Referral",
  },
  sourceDefault: "Referral",
  stage: {
    "Not Contacted": "New",
    "Attempted to Contact": "Contacted",
    "Contact in Future": "Contacted",
    Contacted: "Contacted",
    "Pre-Qualified": "Qualified",
    "Not Qualified": "Lost",
    "Junk Lead": "Lost",
    "Lost Lead": "Lost",
  },
  stageDefault: "New",
};

const SOURCE_VALUES = new Set<string>(LEAD_SOURCES);
const STAGE_VALUES = new Set<string>(LEAD_STAGES);

let warned = false;

export function resetZohoLeadMapWarning(): void {
  warned = false;
}

export function zohoLeadMaps(): ZohoLeadMaps {
  const fromEnv = (process.env.ZOHO_LEAD_MAP ?? "").trim();
  if (fromEnv) {
    const parsed = parseZohoLeadMaps(fromEnv);
    if (parsed) {
      return parsed;
    }
  }
  const file =
    (process.env.ZOHO_LEAD_MAP_FILE ?? "").trim() || path.join(process.cwd(), "config", "zoho-lead-map.json");
  try {
    const parsed = parseZohoLeadMaps(readFileSync(file, "utf8"));
    if (parsed) {
      return parsed;
    }
  } catch {
    warnOnce("zoho lead map file could not be read; using the default map");
  }
  return DEFAULT_ZOHO_LEAD_MAPS;
}

export type ZohoChoice<T extends string> = {
  value: T;
  known: boolean;
  raw: string;
};

export function mapZohoSource(raw: string | null, maps = zohoLeadMaps()): ZohoChoice<LeadSource> | null {
  return mapChoice(raw, maps.source, maps.sourceDefault);
}

export function mapZohoStage(raw: string | null, maps = zohoLeadMaps()): ZohoChoice<LeadStage> | null {
  return mapChoice(raw, maps.stage, maps.stageDefault);
}

function mapChoice<T extends string>(
  raw: string | null,
  table: Record<string, T>,
  fallback: T,
): ZohoChoice<T> | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const key = normalizeLabel(trimmed);
  for (const [name, value] of Object.entries(table)) {
    if (normalizeLabel(name) === key) {
      return { value, known: true, raw: trimmed };
    }
  }
  return { value: fallback, known: false, raw: trimmed };
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseZohoLeadMaps(raw: string): ZohoLeadMaps | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    warnOnce("zoho lead map is not valid JSON; using the default map");
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnOnce("zoho lead map must be a JSON object; using the default map");
    return null;
  }
  const record = value as Record<string, unknown>;
  const source = { ...DEFAULT_ZOHO_LEAD_MAPS.source };
  const stage = { ...DEFAULT_ZOHO_LEAD_MAPS.stage };
  copyValid(record.source, source, SOURCE_VALUES);
  copyValid(record.stage, stage, STAGE_VALUES);
  const sourceDefault = choiceDefault(record.sourceDefault, SOURCE_VALUES, DEFAULT_ZOHO_LEAD_MAPS.sourceDefault);
  const stageDefault = choiceDefault(record.stageDefault, STAGE_VALUES, DEFAULT_ZOHO_LEAD_MAPS.stageDefault);
  return { source, stage, sourceDefault, stageDefault };
}

function copyValid<T extends string>(input: unknown, target: Record<string, T>, allowed: Set<string>): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return;
  }
  for (const [key, value] of Object.entries(input)) {
    const name = key.trim();
    if (!name || typeof value !== "string" || !allowed.has(value)) {
      continue;
    }
    target[name] = value as T;
  }
}

function choiceDefault<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  if (typeof value === "string" && allowed.has(value)) {
    return value as T;
  }
  return fallback;
}

function warnOnce(message: string): void {
  if (warned) {
    return;
  }
  warned = true;
  logWarn(message, { integration: "zoho" });
}
