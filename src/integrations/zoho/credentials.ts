import { integrationCredentialValues } from "../../config";
import { zohoOrigin } from "./http";

const PLACEHOLDER = /dummy|changeme|change-me|placeholder|replace[-_ ]?me|replace_with|your[-_ ]?client/i;

/** True when OAuth values are present and are not short or placeholder stand-ins. */
export function zohoCredentialsLookReal(): boolean {
  try {
    const creds = integrationCredentialValues("zoho");
    const accounts = creds.ZOHO_ACCOUNTS_DOMAIN ?? "";
    const api = creds.ZOHO_API_DOMAIN ?? "";
    if (!accounts || !api || PLACEHOLDER.test(accounts) || PLACEHOLDER.test(api)) {
      return false;
    }
    zohoOrigin(accounts);
    zohoOrigin(api);
    return [creds.ZOHO_CLIENT_ID, creds.ZOHO_CLIENT_SECRET, creds.ZOHO_REFRESH_TOKEN].every(credentialLooksReal);
  } catch {
    return false;
  }
}

function credentialLooksReal(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < 16 || PLACEHOLDER.test(trimmed)) {
    return false;
  }
  return !/^(test|fake|sample|example|xxx+|todo|secret|password)$/i.test(trimmed);
}
