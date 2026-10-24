import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { logError, logInfo } from "../lib/logger";
import { prisma } from "../lib/prisma";

type Tx = Prisma.TransactionClient;

export interface PushMessage {
  token: string;
  notification: {
    title: string;
    body: string;
  };
  data: Record<string, string>;
  android: {
    priority: "high";
    notification: {
      channelId: "coverage_notifications";
      sound: "default";
    };
  };
  apns: {
    headers: {
      "apns-priority": "10";
    };
    payload: {
      aps: {
        sound: "default";
        badge: number;
      };
    };
  };
}

export interface PushSendResult {
  token: string;
  errorCode: string | null;
}

const INVALID_TOKEN = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

const queuedIds = new AsyncLocalStorage<string[]>();
let warned = false;
let sender: (messages: PushMessage[]) => Promise<PushSendResult[]> = sendWithFirebase;

export function queueNotificationPushes(ids: string[]): void {
  const batch = queuedIds.getStore();
  if (!batch) {
    return;
  }
  batch.push(...ids);
}

export function setPushSender(next: ((messages: PushMessage[]) => Promise<PushSendResult[]>) | null): void {
  sender = next ?? sendWithFirebase;
}

export async function deliveringTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  const ids: string[] = [];
  const result = await prisma.$transaction((tx) => queuedIds.run(ids, () => fn(tx)), options);
  await deliverPushes(ids);
  return result;
}

async function deliverPushes(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return;
  }
  try {
    const rows = await prisma.notification.findMany({ where: { id: { in: unique } } });
    if (rows.length === 0) {
      return;
    }
    const devices = await prisma.notificationDevice.findMany({
      where: { caregiverId: { in: [...new Set(rows.map((row) => row.userId))] } },
    });
    const tokensByCaregiver = new Map<string, string[]>();
    for (const device of devices) {
      const list = tokensByCaregiver.get(device.caregiverId) ?? [];
      list.push(device.token);
      tokensByCaregiver.set(device.caregiverId, list);
    }
    const caregiverIds = [...new Set(rows.map((row) => row.userId))];
    const unread = await prisma.notification.groupBy({
      by: ["userId"],
      where: { userId: { in: caregiverIds }, readAt: null },
      _count: { _all: true },
    });
    const unreadByCaregiver = new Map(unread.map((row) => [row.userId, row._count._all]));
    const messages: PushMessage[] = [];
    for (const row of rows) {
      const message = toPushMessage(row, unreadByCaregiver.get(row.userId) ?? 0);
      if (!message) {
        continue;
      }
      for (const token of tokensByCaregiver.get(row.userId) ?? []) {
        messages.push({ ...message, token });
      }
    }
    if (messages.length === 0) {
      return;
    }
    const results: PushSendResult[] = [];
    for (let index = 0; index < messages.length; index += 500) {
      results.push(...(await sender(messages.slice(index, index + 500))));
    }
    const stale = results.filter((result) => result.errorCode !== null && INVALID_TOKEN.has(result.errorCode)).map((result) => result.token);
    if (stale.length > 0) {
      await prisma.notificationDevice.deleteMany({ where: { token: { in: stale } } });
    }
  } catch (error) {
    logError("push delivery failed", { name: error instanceof Error ? error.name : "Error" });
  }
}

function text(value: string | null): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  return value;
}

function toPushMessage(
  row: { id: string; type: string; title: string; body: string; releaseId: string | null; appointmentId: string | null },
  badge: number,
): Omit<PushMessage, "token"> | null {
  const title = text(row.title);
  const body = text(row.body);
  const type = text(row.type);
  if (!title || !body || !type) {
    return null;
  }
  const data: Record<string, string> = {
    notificationId: row.id,
    type,
    title,
    body,
  };
  const releaseId = text(row.releaseId);
  const appointmentId = text(row.appointmentId);
  if (releaseId) {
    data.releaseId = releaseId;
  }
  if (appointmentId) {
    data.appointmentId = appointmentId;
  }
  return {
    notification: { title, body },
    data,
    android: {
      priority: "high",
      notification: {
        channelId: "coverage_notifications",
        sound: "default",
      },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", badge } },
    },
  };
}

function serviceAccount(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    return null;
  }
  try {
    const json = raw.startsWith("{") ? raw : readFileSync(raw, "utf8");
    const parsed = JSON.parse(json) as { project_id?: string; client_email?: string; private_key?: string };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("Firebase service account is missing project_id, client_email, or private_key");
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  } catch (error) {
    if (!warned) {
      warned = true;
      logError("Firebase push is not configured", { name: error instanceof Error ? error.name : "Error" });
    }
    return null;
  }
}

async function sendWithFirebase(messages: PushMessage[]): Promise<PushSendResult[]> {
  const account = serviceAccount();
  if (!account) {
    if (!warned && process.env.NODE_ENV !== "test") {
      warned = true;
      logInfo("Firebase push is not configured");
    }
    return messages.map((message) => ({ token: message.token, errorCode: null }));
  }
  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  const response = await getMessaging(app).sendEach(messages);
  return messages.map((message, index) => ({
    token: message.token,
    errorCode: response.responses[index]?.error?.code ?? null,
  }));
}
