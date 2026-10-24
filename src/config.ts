import dotenv from "dotenv";

dotenv.config();

function required(name: string, minimumLength = 1): string {
  const value = process.env[name];
  if (!value || value.trim().length < minimumLength) {
    throw new Error(
      `Missing or too-short environment variable ${name}. Copy .env.example to .env and set a real value.`,
    );
  }
  return value;
}

const corsRaw = process.env.CORS_ORIGINS ?? "";

const KNOWN_EXAMPLE_SECRETS = new Set([
  "replace-with-a-random-string-at-least-32-characters",
  "replace-with-a-different-random-string-at-least-32-characters",
  "test-jwt-secret-must-be-32-characters-long",
  "test-refresh-pepper-must-be-32-characters",
]);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", 32),
  refreshTokenPepper: required("REFRESH_TOKEN_PEPPER", 32),
  corsOrigins: corsRaw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
};

if (config.nodeEnv === "production") {
  if (KNOWN_EXAMPLE_SECRETS.has(config.jwtSecret) || KNOWN_EXAMPLE_SECRETS.has(config.refreshTokenPepper)) {
    throw new Error(
      "Refusing to start in production because JWT_SECRET or REFRESH_TOKEN_PEPPER is an example value.",
    );
  }
  if (config.jwtSecret === config.refreshTokenPepper) {
    throw new Error(
      "Refusing to start in production because JWT_SECRET and REFRESH_TOKEN_PEPPER must be different.",
    );
  }
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
