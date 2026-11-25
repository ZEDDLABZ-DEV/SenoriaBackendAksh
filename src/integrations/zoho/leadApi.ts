import { integrationCredentialValues } from "../../config";
import { zohoAccessToken } from "./auth";
import { zohoCredentialsLookReal } from "./credentials";
import { zohoOrigin, zohoRequest } from "./http";
import { zohoCrmModule } from "./module";

/** GET one CRM record. Returns null when credentials are missing or look like placeholders. */
export async function fetchZohoLeadRecord(recordId: string): Promise<unknown | null> {
  if (!zohoCredentialsLookReal()) {
    return null;
  }
  const creds = integrationCredentialValues("zoho");
  const token = await zohoAccessToken();
  const api = zohoOrigin(creds.ZOHO_API_DOMAIN);
  const response = await zohoRequest(`${api}/crm/v2/${zohoCrmModule()}/${encodeURIComponent(recordId)}`, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Zoho request failed with status ${response.status}`);
  }
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Zoho response was not JSON");
  }
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
  const first = Array.isArray(data) ? data[0] : undefined;
  if (!first || typeof first !== "object") {
    throw new Error("Zoho response did not include a record");
  }
  return first;
}
