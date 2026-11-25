import { readIntegrationEnv } from "../config";
import { logWarn } from "../lib/logger";
import { INTEGRATION_NAMES, type IntegrationName, type IntegrationStatus } from "./types";

const warned = new Set<IntegrationName>();

export function resetIntegrationWarnings(): void {
  warned.clear();
}

/** True only when the vendor flag is true and every required credential is non-empty. */
export function isIntegrationEnabled(name: IntegrationName): boolean {
  const state = readIntegrationEnv(name);
  if (state.flagEnabled && !state.configured) {
    if (!warned.has(name)) {
      warned.add(name);
      logWarn("integration enabled flag is set but credentials are missing; treating integration as disabled", {
        integration: name,
      });
    }
    return false;
  }
  warned.delete(name);
  return state.enabled;
}

export function getIntegrationStatus(): IntegrationStatus {
  const status = {} as IntegrationStatus;
  for (const name of INTEGRATION_NAMES) {
    const state = readIntegrationEnv(name);
    status[name] = {
      enabled: isIntegrationEnabled(name),
      configured: state.configured,
    };
  }
  return status;
}

/** Vendor HTTP must not run unless the flag is true and credentials are complete. */
export function assertIntegrationCallable(name: IntegrationName): void {
  if (!isIntegrationEnabled(name)) {
    throw new Error(`${name} integration is disabled`);
  }
}
