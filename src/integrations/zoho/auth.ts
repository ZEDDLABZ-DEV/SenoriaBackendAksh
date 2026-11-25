import { integrationCredentialValues } from "../../config";
import { zohoOrigin, zohoRequest } from "./http";

type CachedToken = {
  accessToken: string;
  refreshAt: number;
};

let cached: CachedToken | null = null;

export function resetZohoAuthCache(): void {
  cached = null;
}

export async function zohoAccessToken(now = Date.now()): Promise<string> {
  if (cached && cached.refreshAt > now) {
    return cached.accessToken;
  }
  const creds = integrationCredentialValues("zoho");
  const origin = zohoOrigin(creds.ZOHO_ACCOUNTS_DOMAIN);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: creds.ZOHO_CLIENT_ID,
    client_secret: creds.ZOHO_CLIENT_SECRET,
    refresh_token: creds.ZOHO_REFRESH_TOKEN,
  });
  const response = await zohoRequest(`${origin}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`Zoho request failed with status ${response.status}`);
  }
  const accessToken = payload && typeof payload === "object" ? (payload as { access_token?: unknown }).access_token : undefined;
  const expiresIn = payload && typeof payload === "object" ? (payload as { expires_in?: unknown }).expires_in : undefined;
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    throw new Error("Zoho token response did not include an access token");
  }
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  const lifetimeMs = Math.max(1_000, seconds * 1000 - 60_000);
  cached = { accessToken, refreshAt: now + lifetimeMs };
  return accessToken;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
