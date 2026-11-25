import { assertIntegrationCallable } from "../status";

export type OutlookHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

let http: OutlookHttp = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

export function setOutlookHttp(next: OutlookHttp | null): void {
  http = next ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
}

export function outlookHttp(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  assertIntegrationCallable("outlook");
  return http(url, init);
}

/** Tenant id is a GUID or a DNS name. It is never taken from a URL the client sends. */
export function outlookTenantSegment(value: string): string {
  const trimmed = value.trim();
  const guid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const domain =
    /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  if (!guid.test(trimmed) && !domain.test(trimmed)) {
    throw new Error("Outlook tenant id is not valid");
  }
  return encodeURIComponent(trimmed);
}

/** Mailbox user principal name, such as calendar@senoria.com. */
export function outlookMailboxSegment(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed) || trimmed.length > 320) {
    throw new Error("Outlook calendar user is not a mailbox UPN");
  }
  return encodeURIComponent(trimmed);
}

export function outlookEventSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024 || /[\s\u0000-\u001f]/.test(trimmed)) {
    throw new Error("Outlook event id is not valid");
  }
  return encodeURIComponent(trimmed);
}

export async function readOutlookJson(response: Response): Promise<unknown> {
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
