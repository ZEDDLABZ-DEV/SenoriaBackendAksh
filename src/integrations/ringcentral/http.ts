import { assertIntegrationCallable } from "../status";

export type RingCentralHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

let http: RingCentralHttp = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

export function setRingCentralHttp(next: RingCentralHttp | null): void {
  http = next ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
}

export function ringCentralHttp(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  assertIntegrationCallable("ringcentral");
  return http(url, init);
}

export function ringCentralOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("RingCentral server URL must be an https origin");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error("RingCentral server URL must be an https origin");
  }
  return url.origin;
}

export function ringCentralPathSegment(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9~_.-]+$/.test(trimmed)) {
    throw new Error("RingCentral account or extension id is not a valid path segment");
  }
  return encodeURIComponent(trimmed);
}

export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export async function readRingCentralJson(response: Response): Promise<unknown> {
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
