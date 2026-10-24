import dotenv from "dotenv";

dotenv.config();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL is required. Point it at an isolated database whose name contains 'test'.");
}
if (!/test/i.test(testUrl)) {
  throw new Error("Refusing to test: TEST_DATABASE_URL must contain 'test'.");
}
if (/prod/i.test(testUrl)) {
  throw new Error("Refusing to test: TEST_DATABASE_URL must not refer to a production database.");
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = "test-jwt-secret-must-be-32-characters-long";
}
if (!process.env.REFRESH_TOKEN_PEPPER || process.env.REFRESH_TOKEN_PEPPER.length < 32) {
  process.env.REFRESH_TOKEN_PEPPER = "test-refresh-pepper-must-be-32-characters";
}
