import cors from "cors";
import express from "express";
import { config } from "./config";
import { asyncHandler } from "./http/asyncHandler";
import { logInfo } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiRouter } from "./routes/api";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const started = Date.now();
    const path = req.originalUrl.split("?")[0];
    res.on("finish", () => {
      logInfo("request", {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - started,
      });
    });
    next();
  });

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        res.status(503).json({ status: "error", database: "down" });
        return;
      }
      res.status(200).json({ status: "ok", database: "up" });
    }),
  );

  app.use("/api/v1", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
