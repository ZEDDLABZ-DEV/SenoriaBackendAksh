export const INTEGRATION_NAMES = ["meta", "ringcentral", "zoho", "outlook"] as const;

export type IntegrationName = (typeof INTEGRATION_NAMES)[number];

export type IntegrationVendorStatus = {
  enabled: boolean;
  configured: boolean;
};

export type IntegrationStatus = Record<IntegrationName, IntegrationVendorStatus>;
