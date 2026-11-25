import type { CallDirection, CallResult } from "../../domain/sales";
import { httpUrl } from "./http";

export type ParsedCallLog = {
  externalId: string;
  direction: CallDirection;
  result: CallResult;
  phone: string;
  partyName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  recordingId: string | null;
  recordingContentUri: string | null;
};

export type CallLogRead = { ok: true; call: ParsedCallLog } | { ok: false; reason: string; externalId: string | null };

const NAMED_RESULTS: Record<string, CallResult> = {
  "call connected": "Connected",
  accepted: "Connected",
  connected: "Connected",
  voicemail: "Voicemail",
  "sent to voicemail": "Voicemail",
  reply: "Voicemail",
  missed: "Missed",
  "missed call": "Missed",
  "no answer": "No answer",
  busy: "No answer",
  rejected: "No answer",
  declined: "No answer",
  "call failed": "No answer",
  stopped: "No answer",
  abandoned: "No answer",
  "ip phone offline": "No answer",
  "not allowed": "No answer",
  "wrong number": "No answer",
};

export function readCallLogs(payload: unknown): CallLogRead[] {
  return callLogInputs(payload).map(readCallLog);
}

export function callLogInputs(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const body = (payload as { body?: unknown }).body;
  if (Array.isArray(body)) {
    return body;
  }
  if (body && typeof body === "object") {
    return [body];
  }
  const record = payload as Record<string, unknown>;
  if ("direction" in record || "telephonySessionId" in record || "startTime" in record) {
    return [payload];
  }
  return [];
}

function readCallLog(value: unknown): CallLogRead {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "record", externalId: null };
  }
  const record = value as Record<string, unknown>;
  const externalId = readExternalId(record);
  const type = record.type;
  if (typeof type === "string" && type.trim() && type.trim().toLowerCase() !== "voice") {
    return { ok: false, reason: "not_voice", externalId };
  }
  if (!externalId) {
    return { ok: false, reason: "id", externalId: null };
  }
  const direction = readDirection(record.direction);
  if (!direction) {
    return { ok: false, reason: "direction", externalId };
  }
  const startedAt = readDate(record.startTime);
  if (!startedAt) {
    return { ok: false, reason: "started_at", externalId };
  }
  const party = partyFor(record, direction);
  if (!party.phone.trim()) {
    return { ok: false, reason: "phone", externalId };
  }
  const durationSeconds = readDuration(record);
  const recording = readRecording(record.recording);
  return {
    ok: true,
    call: {
      externalId,
      direction,
      result: mapResult(record.result, durationSeconds),
      phone: party.phone.trim(),
      partyName: party.name,
      startedAt,
      endedAt: durationSeconds === null ? null : new Date(startedAt.getTime() + durationSeconds * 1000),
      durationSeconds,
      recordingId: recording.id,
      recordingContentUri: recording.contentUri,
    },
  };
}

function readExternalId(record: Record<string, unknown>): string | null {
  for (const key of ["telephonySessionId", "sessionId", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const id = value.trim();
      return id.length <= 1024 ? id : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function readDirection(value: unknown): CallDirection | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "outbound") {
    return "Outbound";
  }
  if (normalized === "inbound") {
    return "Inbound";
  }
  return null;
}

export function mapResult(value: unknown, durationSeconds: number | null): CallResult {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "hang up") {
    return durationSeconds !== null && durationSeconds > 0 ? "Connected" : "No answer";
  }
  const named = NAMED_RESULTS[normalized];
  if (named) {
    return named;
  }
  return durationSeconds !== null && durationSeconds > 0 ? "Connected" : "No answer";
}

function readDuration(record: Record<string, unknown>): number | null {
  const seconds = readNonNegative(record.duration);
  if (seconds !== null) {
    return Math.min(Math.round(seconds), 2_147_483_647);
  }
  const millis = readNonNegative(record.durationMs);
  if (millis !== null) {
    return Math.min(Math.round(millis / 1000), 2_147_483_647);
  }
  return null;
}

function readNonNegative(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function partyFor(record: Record<string, unknown>, direction: CallDirection): { phone: string; name: string | null } {
  const to = readEndpoint(record.to);
  const from = readEndpoint(record.from);
  const chosen = direction === "Outbound" ? (to ?? from) : (from ?? to);
  return chosen ?? { phone: "", name: null };
}

function readEndpoint(value: unknown): { phone: string; name: string | null } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const phone = (value as { phoneNumber?: unknown }).phoneNumber;
  if (typeof phone !== "string" || !phone.trim()) {
    return null;
  }
  const name = (value as { name?: unknown }).name;
  const partyName = typeof name === "string" && name.trim() ? name.trim() : null;
  return { phone, name: partyName };
}

function readRecording(value: unknown): { id: string | null; contentUri: string | null } {
  if (!value || typeof value !== "object") {
    return { id: null, contentUri: null };
  }
  const idValue = (value as { id?: unknown }).id;
  const id = typeof idValue === "string" && idValue.trim() ? idValue.trim() : null;
  return { id, contentUri: httpUrl((value as { contentUri?: unknown }).contentUri) };
}
