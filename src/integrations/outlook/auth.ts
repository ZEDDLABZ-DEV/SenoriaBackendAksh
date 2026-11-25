import { integrationCredentialValues } from "../../config";
import { outlookHttp, outlookTenantSegment, readOutlookJson } from "./http";

type CachedToken = {
  accessToken: string;
  refreshAt: number;
  clientId: string;
  tenantId: string;
  secret: string;
};

let cached: CachedToken | null = null;

export function resetOutlookAuthCache(): void {
  cached = null;
}

/**
 * Client-credentials token for Microsoft Graph. The secret and the access token are not logged.
 * Callers must check that Outlook is enabled before calling this.
 */
export async function outlookAccessToken(nowMs = Date.now()): Promise<string> {
  const creds = integrationCredentialValues("outlook");
  if (
    cached &&
    cached.clientId === creds.OUTLOOK_CLIENT_ID &&
    cached.tenantId === creds.OUTLOOK_TENANT_ID &&
    cached.secret === creds.OUTLOOK_CLIENT_SECRET &&
    cached.refreshAt > nowMs
  ) {
    return cached.accessToken;
  }
  const tenant = outlookTenantSegment(creds.OUTLOOK_TENANT_ID);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.OUTLOOK_CLIENT_ID,
    client_secret: creds.OUTLOOK_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await outlookHttp(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const payload = await readOutlookJson(response);
  if (!response.ok) {
    throw new Error(`Outlook request failed with status ${response.status}`);
  }
  const accessToken = payload && typeof payload === "object" ? (payload as { access_token?: unknown }).access_token : undefined;
  const expiresIn = payload && typeof payload === "object" ? (payload as { expires_in?: unknown }).expires_in : undefined;
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new Error("Outlook token response did not include an access token");
  }
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  const lifetimeMs = Math.max(1_000, seconds * 1000 - 60_000);
  cached = {
    accessToken,
    refreshAt: nowMs + lifetimeMs,
    clientId: creds.OUTLOOK_CLIENT_ID,
    tenantId: creds.OUTLOOK_TENANT_ID,
    secret: creds.OUTLOOK_CLIENT_SECRET,
  };
  return accessToken;
}
