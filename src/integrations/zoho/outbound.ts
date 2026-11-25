const GUARD_MS = 10 * 60 * 1000;
const inboundGuard = new Map<string, number>();

export function resetZohoOutboundGuard(): void {
  inboundGuard.clear();
}

/** Remember a lead that was just written from Zoho so a later push does not echo it. */
export function markZohoInboundLoopGuard(leadId: string, at = Date.now()): void {
  if (!leadId) {
    return;
  }
  pruneZohoInboundLoopGuard(at);
  inboundGuard.set(leadId, at);
}

export function zohoInboundLoopGuardActive(leadId: string, at = Date.now()): boolean {
  const marked = inboundGuard.get(leadId);
  return marked !== undefined && at - marked <= GUARD_MS;
}

export function isZohoOutboundEnabled(): boolean {
  return (process.env.ZOHO_OUTBOUND_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Reserved for Senoria → Zoho lead push.
 * This is a no-op. ZOHO_OUTBOUND_ENABLED does not send leads.
 * An id marked by inbound sync is ignored so a future push cannot echo the webhook.
 */
export function enqueueZohoLeadOutbound(leadId: string): void {
  if (!isZohoOutboundEnabled()) {
    return;
  }
  if (zohoInboundLoopGuardActive(leadId)) {
    return;
  }
}

function pruneZohoInboundLoopGuard(at: number): void {
  for (const [id, marked] of inboundGuard) {
    if (at - marked > GUARD_MS) {
      inboundGuard.delete(id);
    }
  }
}
