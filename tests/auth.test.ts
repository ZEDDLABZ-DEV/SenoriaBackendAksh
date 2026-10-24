import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  PASSWORD,
  auth,
  createUser,
  login,
  prepare,
  restoreClock,
  testApp,
} from "./helpers";

const app = testApp();

beforeEach(async () => {
  await prepare();
});

afterAll(() => {
  restoreClock();
});

describe("POST /api/v1/auth/login", () => {
  it("returns the caregiver login contract", async () => {
    const caregiver = await createUser({
      email: "alex.rivera@example.com",
      firstName: "Alex",
      lastName: "Rivera",
    });
    const response = await login(app, caregiver.email);
    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body.message).toBe("Signed in");
    expect(response.body.data.user).toEqual({
      id: caregiver.id,
      email: caregiver.email,
      firstName: "Alex",
      lastName: "Rivera",
      role: "CAREGIVER",
      avatar: null,
      permissions: [],
    });
    expect(response.body.data.expiresIn).toBe(3600);
    expect(response.body.data.accessToken.split(".")).toHaveLength(3);
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken.split(".").length).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("rejects a wrong password and an inactive user, and ignores a submitted role", async () => {
    const caregiver = await createUser({ email: "caregiver@example.com" });
    const wrong = await login(app, caregiver.email, "wrong-password");
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ message: "Invalid email or password", code: "INVALID_CREDENTIALS" });

    await prisma.user.update({ where: { id: caregiver.id }, data: { status: "inactive" } });
    const inactive = await login(app, caregiver.email);
    expect(inactive.status).toBe(401);

    await prisma.user.update({ where: { id: caregiver.id }, data: { status: "active" } });
    const otherRole = await request(app).post("/api/v1/auth/login").send({
      email: caregiver.email,
      password: PASSWORD,
      role: "ADMIN",
    });
    expect(otherRole.status).toBe(200);
    expect(otherRole.body.data.user.role).toBe("CAREGIVER");
    expect(otherRole.body.data.accessToken).toEqual(expect.any(String));

    const admin = await createUser({ role: "ADMIN", email: "admin@example.com" });
    const adminLogin = await login(app, admin.email);
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.data.user.role).toBe("ADMIN");
    expect(adminLogin.body.data.expiresIn).toBe(3600);
    expect(adminLogin.body.data.accessToken).toEqual(expect.any(String));
  });

  it("returns 422 with an errors object for invalid login fields", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: "not-an-email",
      password: "short",
      role: "CAREGIVER",
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.errors.email).toEqual(expect.any(Array));
    expect(response.body.errors.password[0]).toContain("at least 6");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("returns a new access token and keeps the same refresh token until logout", async () => {
    const caregiver = await createUser({ email: "refresh@example.com" });
    const signedIn = await login(app, caregiver.email);
    const original = signedIn.body.data.refreshToken as string;

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Accept", "application/json")
      .send({ refreshToken: original });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.expiresIn).toBe(3600);
    expect(refreshed.body.data.accessToken.split(".")).toHaveLength(3);
    expect(refreshed.body.data.refreshToken).toBeUndefined();

    const reused = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(reused.status).toBe(200);
    expect(reused.body.data.expiresIn).toBe(3600);

    const loggedOut = await request(app)
      .post("/api/v1/auth/logout")
      .set(auth(signedIn.body.data.accessToken));
    expect(loggedOut.status).toBe(200);

    const afterLogout = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: original });
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.code).toBe("REFRESH_EXPIRED");
  });

  it("accepts a valid refresh body even when a bearer header is absent or stale", async () => {
    const caregiver = await createUser({ email: "no-bearer@example.com" });
    const signedIn = await login(app, caregiver.email);
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Authorization", "Bearer not-a-jwt")
      .send({ refreshToken: signedIn.body.data.refreshToken });
    expect(response.status).toBe(200);
  });

  it("rejects an unknown refresh token and a deactivated user", async () => {
    const unknown = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "missing-token" });
    expect(unknown.status).toBe(401);

    const caregiver = await createUser({ email: "disabled@example.com" });
    const signedIn = await login(app, caregiver.email);
    await prisma.user.update({ where: { id: caregiver.id }, data: { status: "inactive" } });
    const disabled = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: signedIn.body.data.refreshToken });
    expect(disabled.status).toBe(401);
  });
});

describe("access tokens", () => {
  it("requires a current caregiver token", async () => {
    const missing = await request(app).get("/api/v1/appointments/caregiver/00000000-0000-4000-8000-000000000001");
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe("UNAUTHENTICATED");

    const caregiver = await createUser({ email: "token@example.com" });
    const expired = jwt.sign({ role: "CAREGIVER" }, process.env.JWT_SECRET!, {
      subject: caregiver.id,
      expiresIn: "-10s",
      algorithm: "HS256",
    });
    const expiredResponse = await request(app)
      .get(`/api/v1/appointments/caregiver/${caregiver.id}`)
      .set(auth(expired));
    expect(expiredResponse.status).toBe(401);

    const bad = await request(app)
      .get(`/api/v1/appointments/caregiver/${caregiver.id}`)
      .set(auth("not.a.jwt"));
    expect(bad.status).toBe(401);
  });

  it("keeps administrator and caregiver authorization separate", async () => {
    const admin = await createUser({ role: "ADMIN", email: "staff@example.com" });
    const adminLogin = await request(app).post("/api/v1/admin/auth/login").send({
      email: admin.email,
      password: PASSWORD,
    });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.data.user.role).toBe("ADMIN");
    expect(adminLogin.body.data.expiresIn).toBe(3600);

    const caregiver = await createUser({ email: "mobile@example.com" });
    const caregiverOnAdmin = await request(app).post("/api/v1/admin/auth/login").send({
      email: caregiver.email,
      password: PASSWORD,
    });
    expect(caregiverOnAdmin.status).toBe(403);

    const caregiverSession = await login(app, caregiver.email);
    const blocked = await request(app)
      .get("/api/v1/admin/dashboard")
      .set(auth(caregiverSession.body.data.accessToken));
    expect(blocked.status).toBe(403);

    const adminOnCaregiverRoute = await request(app)
      .get(`/api/v1/appointments/caregiver/${admin.id}`)
      .set(auth(adminLogin.body.data.accessToken));
    expect(adminOnCaregiverRoute.status).toBe(403);

    const missingAdmin = await request(app).get("/api/v1/admin/dashboard");
    expect(missingAdmin.status).toBe(401);
  });
});
