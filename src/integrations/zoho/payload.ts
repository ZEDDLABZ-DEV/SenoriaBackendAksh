const MAX_RECORDS = 25;

const FIELD_ALIASES = {
  id: ["id", "record_id", "lead_id"],
  firstName: ["first_name", "firstname"],
  lastName: ["last_name", "lastname"],
  email: ["email"],
  phone: ["phone"],
  mobile: ["mobile"],
  description: ["description"],
  leadSource: ["lead_source"],
  leadStatus: ["lead_status"],
} as const;

export type ZohoFieldBag = {
  externalId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  emailPresent: boolean;
  description: string | null;
  descriptionPresent: boolean;
  leadSource: string | null;
  leadStatus: string | null;
  idOnly: boolean;
};

export function zohoWebhookRecords(body: unknown): unknown[] {
  const records = collectRecords(body);
  return records.slice(0, MAX_RECORDS);
}

export function zohoWebhookRecordCount(body: unknown): number {
  return collectRecords(body).length;
}

export function parseZohoRecord(value: unknown, fallbackId?: string): ZohoFieldBag | null {
  const flat = flattenRecord(value);
  const externalId = normalizeZohoRecordId(pick(flat, FIELD_ALIASES.id) ?? fallbackId ?? "");
  if (!externalId) {
    return null;
  }
  const firstName = emptyToNull(pick(flat, FIELD_ALIASES.firstName));
  const lastName = emptyToNull(pick(flat, FIELD_ALIASES.lastName));
  const phone = emptyToNull(pick(flat, FIELD_ALIASES.phone)) ?? emptyToNull(pick(flat, FIELD_ALIASES.mobile));
  const emailRaw = pick(flat, FIELD_ALIASES.email);
  const cleanedEmail = cleanEmail(emailRaw);
  const emailInvalid = emailRaw !== null && emailRaw.trim().length > 0 && cleanedEmail === null;
  const emailPresent = emailRaw !== null && !emailInvalid;
  const descriptionRaw = pick(flat, FIELD_ALIASES.description);
  const descriptionPresent = descriptionRaw !== null;
  const description = descriptionRaw === null ? null : descriptionRaw.trim();
  const leadSource = emptyToNull(pick(flat, FIELD_ALIASES.leadSource));
  const leadStatus = emptyToNull(pick(flat, FIELD_ALIASES.leadStatus));
  const idOnly =
    firstName === null &&
    lastName === null &&
    phone === null &&
    !emailPresent &&
    !descriptionPresent &&
    leadSource === null &&
    leadStatus === null;
  return {
    externalId,
    firstName,
    lastName,
    phone,
    email: emailPresent ? cleanedEmail : null,
    emailPresent,
    description,
    descriptionPresent,
    leadSource,
    leadStatus,
    idOnly,
  };
}

/** Strip a leading zcrm_ so webhook ids and CRM ids match. */
export function normalizeZohoRecordId(value: string): string | null {
  const stripped = value.trim().replace(/^zcrm_/i, "");
  if (!/^\d{5,25}$/.test(stripped)) {
    return null;
  }
  return stripped;
}

function collectRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (!isRecord(body)) {
    return [];
  }
  if (Array.isArray(body.data)) {
    return body.data;
  }
  if (isRecord(body.data)) {
    return [body.data];
  }
  if (Array.isArray(body.leads)) {
    return body.leads;
  }
  if (isRecord(body.lead)) {
    return [body.lead];
  }
  if (isRecord(body.record)) {
    return [body.record];
  }
  const flat = flattenRecord(body);
  if (!hasLeadContent(flat) && Array.isArray(body.ids)) {
    return body.ids.map((id) => ({ id }));
  }
  return [body];
}

function hasLeadContent(flat: Record<string, string>): boolean {
  const aliases = [
    ...FIELD_ALIASES.firstName,
    ...FIELD_ALIASES.lastName,
    ...FIELD_ALIASES.email,
    ...FIELD_ALIASES.phone,
    ...FIELD_ALIASES.mobile,
    ...FIELD_ALIASES.description,
    ...FIELD_ALIASES.leadSource,
    ...FIELD_ALIASES.leadStatus,
  ];
  return aliases.some((name) => Object.prototype.hasOwnProperty.call(flat, name));
}

function flattenRecord(value: unknown): Record<string, string> {
  const flat: Record<string, string> = {};
  if (!isRecord(value)) {
    return flat;
  }
  for (const [key, raw] of Object.entries(value)) {
    const text = scalar(raw);
    if (text === undefined) {
      continue;
    }
    flat[normalizeKey(key)] = text;
  }
  return flat;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function pick(flat: Record<string, string>, names: readonly string[]): string | null {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(flat, name)) {
      return flat[name];
    }
  }
  return null;
}

function emptyToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanEmail(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 200 || /\s/.test(trimmed) || !trimmed.includes("@")) {
    return null;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
