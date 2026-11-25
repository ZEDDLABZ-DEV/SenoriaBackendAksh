import { createHash, timingSafeEqual } from "node:crypto";

export function isZohoInboundEnabled(): boolean {
  return (process.env.ZOHO_INBOUND_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Shared secret from X-Zoho-Webhook-Secret. An empty server secret rejects every post. */
export function zohoWebhookAuthorized(header: string | undefined): boolean {
  const expected = (process.env.ZOHO_WEBHOOK_SECRET ?? "").trim();
  if (!expected) {
    return false;
  }
  const provided = (header ?? "").trim();
  const actual = createHash("sha256").update(provided, "utf8").digest();
  const wanted = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actual, wanted);
}
