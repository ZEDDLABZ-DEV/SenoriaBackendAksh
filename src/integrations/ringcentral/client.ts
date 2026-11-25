import { integrationCredentialValues } from "../../config";
import { ringCentralAccessToken } from "./auth";
import { httpUrl, readRingCentralJson, ringCentralHttp, ringCentralOrigin, ringCentralPathSegment } from "./http";

export type RingOutSession = {
  id: string;
  sessionId: string;
};

/** 10-digit numbers are dialed as +1. A leading + is kept. */
export function toRingCentralNumber(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length > 11) {
    return `+${digits}`;
  }
  return trimmed;
}

export async function ringOut(to: string): Promise<RingOutSession> {
  const token = await ringCentralAccessToken();
  const creds = integrationCredentialValues("ringcentral");
  const origin = ringCentralOrigin(creds.RINGCENTRAL_SERVER_URL);
  const accountId = ringCentralPathSegment(creds.RINGCENTRAL_ACCOUNT_ID);
  const extensionId = ringCentralPathSegment(creds.RINGCENTRAL_EXTENSION_ID);
  const response = await ringCentralHttp(
    `${origin}/restapi/v1.0/account/${accountId}/extension/${extensionId}/ring-out`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: { phoneNumber: toRingCentralNumber(creds.RINGCENTRAL_FROM_NUMBER) },
        to: { phoneNumber: toRingCentralNumber(to) },
        playPrompt: false,
      }),
    },
  );
  const payload = await readRingCentralJson(response);
  if (!response.ok) {
    throw new Error(`RingCentral ring-out failed with status ${response.status}`);
  }
  const record = payload && typeof payload === "object" ? (payload as { id?: unknown; sessionId?: unknown }) : {};
  const id = readSessionId(record.id);
  if (!id) {
    throw new Error("RingCentral ring-out response did not include an id");
  }
  return { id, sessionId: readSessionId(record.sessionId) ?? id };
}

export async function fetchRecordingContentUri(
  recordingId: string,
): Promise<{ url: string | null; error: string | null }> {
  if (!/^[A-Za-z0-9~_.-]+$/.test(recordingId)) {
    return { url: null, error: "RingCentral recording metadata request failed" };
  }
  try {
    const token = await ringCentralAccessToken();
    const creds = integrationCredentialValues("ringcentral");
    const origin = ringCentralOrigin(creds.RINGCENTRAL_SERVER_URL);
    const accountId = ringCentralPathSegment(creds.RINGCENTRAL_ACCOUNT_ID);
    const response = await ringCentralHttp(
      `${origin}/restapi/v1.0/account/${accountId}/recording/${encodeURIComponent(recordingId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      return { url: null, error: `RingCentral recording metadata request failed with status ${response.status}` };
    }
    const payload = await readRingCentralJson(response);
    const url = contentUri(payload);
    if (!url) {
      return { url: null, error: "RingCentral recording metadata did not include a content URL" };
    }
    return { url, error: null };
  } catch {
    return { url: null, error: "RingCentral recording metadata request failed" };
  }
}

function readSessionId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function contentUri(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return httpUrl((payload as { contentUri?: unknown }).contentUri);
}
