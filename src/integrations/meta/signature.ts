import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { integrationCredentialValues } from "../../config";

export function metaHubSignature(rawBody: Buffer, appSecret: string): string {
  const digest = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

export function metaSignaturesMatch(expected: string, provided: string | undefined): boolean {
  if (!provided) {
    return false;
  }
  const actual = Buffer.from(provided.trim());
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) {
    return false;
  }
  return timingSafeEqual(actual, wanted);
}

export type MetaPostDecision = "accept" | "reject" | "ignore";

/**
 * App secret present: require a matching X-Hub-Signature-256.
 * App secret absent in production: reject unsigned posts.
 * App secret absent outside production: ignore the post (200, no lead).
 */
export function metaPostDecision(req: Request): MetaPostDecision {
  const secret = integrationCredentialValues("meta").META_APP_SECRET;
  const header = req.header("x-hub-signature-256");
  if (secret) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    return metaSignaturesMatch(metaHubSignature(rawBody, secret), header) ? "accept" : "reject";
  }
  if ((process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return "reject";
  }
  return "ignore";
}

export function metaChallenge(query: Request["query"]): { ok: true; challenge: string } | { ok: false } {
  const mode = queryValue(query, "hub.mode");
  const token = queryValue(query, "hub.verify_token");
  const challenge = queryValue(query, "hub.challenge");
  const expected = integrationCredentialValues("meta").META_WEBHOOK_VERIFY_TOKEN;
  if (mode !== "subscribe" || !expected || token !== expected || !challenge) {
    return { ok: false };
  }
  return { ok: true, challenge };
}

function queryValue(query: Request["query"], key: string): string {
  const direct = query[key];
  if (typeof direct === "string") {
    return direct;
  }
  const [parent, child] = key.split(".");
  const nested = query[parent];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const value = (nested as Record<string, unknown>)[child];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}
