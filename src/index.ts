import { createApp } from "./app";
import { config } from "./config";
import { logInfo } from "./lib/logger";
import { prisma } from "./lib/prisma";
import {
  startAppointmentReminderScheduler,
  stopAppointmentReminderScheduler,
} from "./services/appointmentReminder.service";

const app = createApp();
const server = app.listen(config.port, () => {
  logInfo("api listening", { port: config.port });
  startAppointmentReminderScheduler();
});

async function shutdown(): Promise<void> {
  stopAppointmentReminderScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
