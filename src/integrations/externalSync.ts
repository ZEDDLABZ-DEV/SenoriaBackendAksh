import type { IntegrationName } from "./types";

/** Columns shared by leads and timeline rows. Writers must not log the id. */
export function externalSyncData(source: IntegrationName, externalId: string, syncedAt: Date) {
  return {
    externalSource: source,
    externalId,
    lastSyncedAt: syncedAt,
    syncError: null as string | null,
  };
}
