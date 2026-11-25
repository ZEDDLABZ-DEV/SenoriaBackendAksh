import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { integrationCredentialValues } from "../../config";

export type RingCentralPostDecision = { kind: "reject" } | { kind: "validate"; token: string } | { kind: "accept" };

/**
 * Verification token, when set, must match. Production rejects a post with no token.
 * A Validation-Token header is the subscription handshake and is echoed, not stored.
 */
export function ringCentralPostDecision(req: Request): RingCentralPostDecision {
  const expected = integrationCredentialValues("ringcentral").RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN;
  if (expected) {
    if (!tokensMatch(expected, req.header("verification-token") ?? "")) {
      return { kind: "reject" };
    }
  } else if ((process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return { kind: "reject" };
  }

  const header = req.header("validation-token");
  if (header !== undefined && header !== "") {
    const token = safeHeaderToken(header);
    if (!token) {
      return { kind: "reject" };
    }
    return { kind: "validate", token };
  }
  return { kind: "accept" };
}

function tokensMatch(expected: string, provided: string): boolean {
  const actual = Buffer.from(provided.trim());
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || wanted.length === 0) {
    return false;
  }
  return timingSafeEqual(actual, wanted);
}

function safeHeaderToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
