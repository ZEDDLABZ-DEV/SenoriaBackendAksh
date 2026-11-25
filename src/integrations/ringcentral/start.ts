import { assertUuid } from "../../domain/ids";
import { forbidden, notFound, ringCentralUnavailable, validation } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import type { SalesActor } from "../../services/leads.service";
import { logIntegration } from "../log";
import { isIntegrationEnabled } from "../status";
import { ringOut } from "./client";

export type StartCallResult =
  | { started: false; reason: "ringcentral_not_configured" }
  | { started: true; callId: string; sessionId: string; status: "started" };

/**
 * Places a RingOut call for a lead the actor can access.
 * Does not write a sales call. The call-log webhook does that when the call ends.
 * Returns without calling RingCentral when the integration is off.
 */
export async function startLeadCall(actor: SalesActor, leadId: string): Promise<StartCallResult> {
  assertUuid(leadId);
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, phone: true },
  });
  if (!lead) {
    throw notFound();
  }
  if (actor.role === "SALES" && lead.ownerId !== actor.id) {
    throw forbidden();
  }
  if (!isIntegrationEnabled("ringcentral")) {
    return { started: false, reason: "ringcentral_not_configured" };
  }
  const phone = lead.phone.trim();
  if (!phone) {
    throw validation("Lead has no phone number", { phone: ["Lead has no phone number"] });
  }
  try {
    const session = await ringOut(phone);
    logIntegration("succeeded", {
      integration: "ringcentral",
      externalId: session.id,
      leadId: lead.id,
      callId: session.id,
    });
    return { started: true, callId: session.id, sessionId: session.sessionId, status: "started" };
  } catch {
    logIntegration("failed", { integration: "ringcentral", leadId: lead.id });
    throw ringCentralUnavailable();
  }
}
