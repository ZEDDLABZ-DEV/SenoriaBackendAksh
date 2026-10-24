import { execSync } from "node:child_process";
import dotenv from "dotenv";

export default function globalSetup(): void {
  dotenv.config();
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl || !/test/i.test(testUrl) || /prod/i.test(testUrl)) {
    throw new Error("TEST_DATABASE_URL must identify an isolated test database.");
  }
  const env = { ...process.env, DATABASE_URL: testUrl };
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env,
  });
  execSync("npx prisma db execute --file prisma/preserve-constraints.sql --schema prisma/schema.prisma", {
    stdio: "inherit",
    env,
  });
}
