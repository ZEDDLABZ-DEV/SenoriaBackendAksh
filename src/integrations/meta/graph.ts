import { createHmac } from "node:crypto";
import { integrationCredentialValues } from "../../config";
import { logIntegration } from "../log";
import { assertIntegrationCallable } from "../status";

export type MetaFieldData = {
  name: string;
  values: string[];
};

export type MetaLeadDetail = {
  id: string;
  fieldData: MetaFieldData[];
  platform?: string;
};

export type MetaLeadFetcher = (leadgenId: string) => Promise<MetaLeadDetail>;

const DEFAULT_GRAPH_VERSION = "v23.0";

let fetcher: MetaLeadFetcher = fetchMetaLeadFromGraph;

export function setMetaLeadFetcher(next: MetaLeadFetcher | null): void {
  fetcher = next ?? fetchMetaLeadFromGraph;
}

export function fetchMetaLead(leadgenId: string): Promise<MetaLeadDetail> {
  return fetcher(leadgenId);
}

export async function fetchMetaLeadFromGraph(leadgenId: string): Promise<MetaLeadDetail> {
  assertIntegrationCallable("meta");
  if (!/^[0-9]+$/.test(leadgenId)) {
    throw new Error("Meta lead id is not numeric");
  }
  const creds = integrationCredentialValues("meta");
  const token = creds.META_PAGE_ACCESS_TOKEN;
  const appSecret = creds.META_APP_SECRET;
  const version = graphVersion(creds.META_GRAPH_API_VERSION);
  const proof = createHmac("sha256", appSecret).update(token).digest("hex");
  const url = new URL(`https://graph.facebook.com/${version}/${leadgenId}`);
  url.searchParams.set("fields", "id,created_time,field_data,platform");
  url.searchParams.set("appsecret_proof", proof);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    logIntegration("failed", { integration: "meta", externalId: leadgenId });
    throw new Error("Meta lead fetch failed");
  }
  if (!response.ok) {
    logIntegration("failed", { integration: "meta", externalId: leadgenId });
    throw new Error(`Meta lead fetch failed with status ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  return parseLeadDetail(leadgenId, body);
}

function graphVersion(value: string | undefined): string {
  const version = (value ?? "").trim();
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
}

export function parseLeadDetail(leadgenId: string, body: unknown): MetaLeadDetail {
  if (!body || typeof body !== "object") {
    throw new Error("Meta lead fetch returned an empty body");
  }
  const record = body as { id?: unknown; field_data?: unknown; platform?: unknown };
  const fieldData = Array.isArray(record.field_data) ? record.field_data.flatMap(parseField) : [];
  const platform = typeof record.platform === "string" ? record.platform : undefined;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : leadgenId,
    fieldData,
    platform,
  };
}

function parseField(value: unknown): MetaFieldData[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const name = (value as { name?: unknown }).name;
  const values = (value as { values?: unknown }).values;
  if (typeof name !== "string" || !Array.isArray(values)) {
    return [];
  }
  return [{ name, values: values.filter((item): item is string => typeof item === "string") }];
}
