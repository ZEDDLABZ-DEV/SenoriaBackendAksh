/**
 * Checks a running API while integration flags are false.
 *
 *   BASE_URL=http://127.0.0.1:3000 ACCESS_TOKEN=... LEAD_ID=... MEETING_ID=... node scripts/integrations-smoke.mjs
 *
 * META_WEBHOOK_VERIFY_TOKEN, RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN, and ZOHO_WEBHOOK_SECRET are optional.
 * Set EXPECT_PRODUCTION=true when the server is production and the RingCentral verification token is empty.
 */

const baseUrl = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const accessToken = process.env.ACCESS_TOKEN ?? "";
const leadId = process.env.LEAD_ID ?? "";
const meetingId = process.env.MEETING_ID ?? "";
const metaVerify = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const ringCentralVerify = process.env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN ?? "";
const zohoSecret = process.env.ZOHO_WEBHOOK_SECRET ?? "";
const expectProduction = (process.env.EXPECT_PRODUCTION ?? "").toLowerCase() === "true";

const missing = [
  ["BASE_URL", baseUrl],
  ["ACCESS_TOKEN", accessToken],
  ["LEAD_ID", leadId],
  ["MEETING_ID", meetingId],
].filter(([, value]) => value.length === 0);
if (missing.length > 0) {
  console.error(`Set ${missing.map(([name]) => name).join(", ")}.`);
  process.exit(1);
}

let failed = 0;

function pass(message) {
  console.log(`ok ${message}`);
}

function fail(message) {
  failed += 1;
  console.error(`not ok ${message}`);
}

function endpoint(path) {
  return new URL(path, `${baseUrl}/`);
}

async function request(path, { method = "GET", auth = false, headers = {}, body } = {}) {
  const response = await fetch(endpoint(path), {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, text, json, headers: response.headers };
}

const status = await request("/api/v1/integrations/status", { auth: true });
const vendors = status.json?.data;
const names = ["meta", "ringcentral", "zoho", "outlook"];
if (status.status !== 200 || !vendors) {
  fail(`GET /integrations/status returned ${status.status}`);
} else {
  const enabled = names.filter((name) => vendors[name]?.enabled !== false);
  if (enabled.length > 0) {
    fail(`flags are on for ${enabled.join(", ")}`);
  } else {
    const summary = names.map((name) => `${name} configured=${vendors[name]?.configured === true}`).join(", ");
    pass(`status enabled=false (${summary})`);
  }
}

const challengeUrl = endpoint("/api/v1/webhooks/meta/leads");
challengeUrl.searchParams.set("hub.mode", "subscribe");
challengeUrl.searchParams.set("hub.verify_token", metaVerify);
challengeUrl.searchParams.set("hub.challenge", "smoke-challenge");
const challenge = await fetch(challengeUrl);
const challengeBody = await challenge.text();
if (metaVerify) {
  if (challenge.status === 200 && challengeBody === "smoke-challenge") {
    pass("meta challenge");
  } else {
    fail(`meta challenge returned ${challenge.status}`);
  }
} else if (challenge.status === 403) {
  pass("meta challenge rejected without a verify token");
} else {
  fail(`meta challenge without a verify token returned ${challenge.status}`);
}

const handshakeHeaders = { "Validation-Token": "smoke-validation" };
if (ringCentralVerify) {
  handshakeHeaders["Verification-Token"] = ringCentralVerify;
}
const handshake = await request("/api/v1/webhooks/ringcentral/calls", {
  method: "POST",
  headers: handshakeHeaders,
});
const echoed = handshake.headers.get("validation-token");
if (ringCentralVerify || !expectProduction) {
  if (handshake.status === 200 && echoed === "smoke-validation") {
    pass("ringcentral validation handshake");
  } else {
    fail(`ringcentral handshake returned ${handshake.status}`);
  }
} else if (handshake.status === 403) {
  pass("ringcentral handshake rejected in production without a verification token");
} else {
  fail(`production ringcentral handshake returned ${handshake.status}`);
}

const started = await request(`/api/v1/leads/${encodeURIComponent(leadId)}/calls/start`, {
  method: "POST",
  auth: true,
});
if (
  started.status === 200 &&
  started.json?.success === true &&
  started.json?.data?.started === false &&
  started.json?.data?.reason === "ringcentral_not_configured"
) {
  pass("start call is disabled");
} else {
  fail(`start call returned ${started.status}`);
}

const outlook = await request(`/api/v1/sales/meetings/${encodeURIComponent(meetingId)}/outlook`, {
  method: "POST",
  auth: true,
});
if (
  outlook.status === 200 &&
  outlook.json?.success === true &&
  outlook.json?.data?.synced === false &&
  outlook.json?.data?.reason === "outlook_not_configured"
) {
  pass("outlook push is disabled");
} else {
  fail(`outlook push returned ${outlook.status}`);
}

const zohoDenied = await request("/api/v1/webhooks/zoho/leads", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Zoho-Webhook-Secret": "not-the-secret" },
  body: "{}",
});
if (zohoDenied.status === 403) {
  pass("zoho webhook rejects a bad secret");
} else {
  fail(`zoho webhook bad secret returned ${zohoDenied.status}`);
}
if (zohoSecret) {
  const zohoOk = await request("/api/v1/webhooks/zoho/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Zoho-Webhook-Secret": zohoSecret },
    body: "{}",
  });
  const results = zohoOk.json?.results;
  if (zohoOk.status === 200 && Array.isArray(results) && results.length === 0) {
    pass("zoho webhook accepts the secret");
  } else {
    fail(`zoho webhook returned ${zohoOk.status}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
