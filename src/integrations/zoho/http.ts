import { assertIntegrationCallable } from "../status";

export type ZohoHttp = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

let http: ZohoHttp = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

export function setZohoHttp(next: ZohoHttp | null): void {
  http = next ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
}

export function zohoRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  return http(url, init);
}

export function zohoHttp(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  assertIntegrationCallable("zoho");
  return zohoRequest(url, init);
}

export function zohoOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:") {
    throw new Error("Zoho domain must use https");
  }
  return url.origin;
}
