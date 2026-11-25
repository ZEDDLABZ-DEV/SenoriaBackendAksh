import { integrationCredentialValues } from "../../config";

export function zohoCrmModule(): "Leads" | "Contacts" {
  const value = (integrationCredentialValues("zoho").ZOHO_CRM_MODULE ?? "").trim();
  return value === "Contacts" ? "Contacts" : "Leads";
}
