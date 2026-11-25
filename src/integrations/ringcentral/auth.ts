import { integrationCredentialValues } from "../../config";
import { readRingCentralJson, ringCentralHttp, ringCentralOrigin } from "./http";

type CachedToken = {
  accessToken: string;
  refreshAt: number;
  clientId: string;
};

let cached: CachedToken | null = null;

export function resetRingCentralAuthCache(): void {
  cached = null;
}

/** Exchanges the app JWT for an access token. The JWT and the access token are not logged. */
export async function ringCentralAccessToken(nowMs = Date.now()): Promise<string> {
  const creds = integrationCredentialValues("ringcentral");
  if (cached && cached.clientId === creds.RINGCENTRAL_CLIENT_ID && cached.refreshAt > nowMs) {
    return cached.accessToken;
  }
  const origin = ringCentralOrigin(creds.RINGCENTRAL_SERVER_URL);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: creds.RINGCENTRAL_JWT,
  });
  const basic = Buffer.from(`${creds.RINGCENTRAL_CLIENT_ID}:${creds.RINGCENTRAL_CLIENT_SECRET}`).toString("base64");
  const response = await ringCentralHttp(`${origin}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const payload = await readRingCentralJson(response);
  if (!response.ok) {
    throw new Error(`RingCentral token request failed with status ${response.status}`);
  }
  const accessToken =
    payload && typeof payload === "object" ? (payload as { access_token?: unknown }).access_token : undefined;
  const expiresIn = payload && typeof payload === "object" ? (payload as { expires_in?: unknown }).expires_in : undefined;
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new Error("RingCentral token response did not include an access token");
  }
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  const lifetimeMs = Math.max(1_000, seconds * 1000 - 60_000);
  cached = { accessToken, refreshAt: nowMs + lifetimeMs, clientId: creds.RINGCENTRAL_CLIENT_ID };
  return accessToken;
}
