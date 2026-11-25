import { isIntegrationEnabled } from "./status";
import type { IntegrationName } from "./types";

/**
 * Vendor entry points. Disabled integrations return without doing work.
 * Zoho note sync is queued from note save, not from this method.
 * RingCentral dial and call-log intake run on their own routes.
 * Outlook calendar sync runs from meeting save and POST /sales/meetings/:id/outlook.
 */
export interface SalesIntegrationAdapter {
  readonly name: IntegrationName;
  sync(): Promise<void>;
}

class StubAdapter implements SalesIntegrationAdapter {
  constructor(readonly name: IntegrationName) {}

  async sync(): Promise<void> {
    if (!isIntegrationEnabled(this.name)) {
      return;
    }
    throw new Error(`${this.name} integration is not implemented`);
  }
}

class ZohoAdapter implements SalesIntegrationAdapter {
  readonly name = "zoho" as const;

  async sync(): Promise<void> {
    if (!isIntegrationEnabled(this.name)) {
      return;
    }
  }
}

class RingCentralAdapter implements SalesIntegrationAdapter {
  readonly name = "ringcentral" as const;

  async sync(): Promise<void> {
    if (!isIntegrationEnabled(this.name)) {
      return;
    }
  }
}

class OutlookAdapter implements SalesIntegrationAdapter {
  readonly name = "outlook" as const;

  async sync(): Promise<void> {
    if (!isIntegrationEnabled(this.name)) {
      return;
    }
  }
}

export const integrationAdapters: Record<IntegrationName, SalesIntegrationAdapter> = {
  meta: new StubAdapter("meta"),
  ringcentral: new RingCentralAdapter(),
  zoho: new ZohoAdapter(),
  outlook: new OutlookAdapter(),
};
