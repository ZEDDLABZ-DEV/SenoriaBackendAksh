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

describe("account deletion requests", () => {
  it("lets a caregiver request deletion, blocks login, and lets admin approve", async () => {
    const admin = await createUser({ role: "ADMIN", email: "admin@example.com" });
    const caregiver = await createUser({
      email: "alex.rivera@example.com",
      firstName: "Alex",
      lastName: "Rivera",
    });
    const session = await login(app, caregiver.email);
    const token = session.body.data.accessToken as string;

    const requested = await request(app)
      .post("/api/v1/auth/account-deletion")
      .set(auth(token))
      .send({ reason: "Leaving the company" });
    expect(requested.status).toBe(200);
    expect(requested.body.message).toBe("Account deletion request submitted");
    expect(requested.body.data).toMatchObject({
      userId: caregiver.id,
      reason: "Leaving the company",
      status: "pending",
      resolvedAt: null,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: caregiver.id } });
    expect(user.status).toBe("deletion_pending");

    const refreshTokens = await prisma.refreshToken.findMany({ where: { userId: caregiver.id } });
    expect(refreshTokens.every((row) => row.revokedAt != null)).toBe(true);

    const blocked = await login(app, caregiver.email);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({
      message: "Your account deletion request is pending admin approval. You cannot log in until it is processed.",
      code: "ACCOUNT_DELETION_PENDING",
    });

    const protectedCall = await request(app).get("/api/v1/notifications").set(auth(token));
    expect(protectedCall.status).toBe(401);

    const adminLogin = await request(app).post("/api/v1/admin/auth/login").send({
      email: admin.email,
      password: PASSWORD,
    });
    const adminToken = adminLogin.body.data.accessToken as string;

    const listed = await request(app)
      .get("/api/v1/account-deletion-requests")
      .set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.data).toHaveLength(1);
    expect(listed.body.data.data[0]).toMatchObject({
      id: requested.body.data.id,
      status: "pending",
      user: {
        id: caregiver.id,
        email: caregiver.email,
        firstName: "Alex",
        lastName: "Rivera",
        status: "deletion_pending",
      },
    });

    const approved = await request(app)
      .post(`/api/v1/account-deletion-requests/${requested.body.data.id}/approve`)
      .set(auth(adminToken));
    expect(approved.status).toBe(200);
    expect(approved.body.message).toBe("Account deletion approved");
    expect(approved.body.data).toMatchObject({
      status: "approved",
      reviewedById: admin.id,
      user: { id: caregiver.id, status: "inactive" },
    });
    expect(approved.body.data.resolvedAt).toEqual(expect.any(String));

    const afterApprove = await prisma.user.findUniqueOrThrow({ where: { id: caregiver.id } });
    expect(afterApprove.status).toBe("inactive");

    const inactiveLogin = await login(app, caregiver.email);
    expect(inactiveLogin.status).toBe(401);
    expect(inactiveLogin.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("lets admin reject a deletion request and restores login", async () => {
    const admin = await createUser({ role: "ADMIN", email: "admin@example.com" });
    const caregiver = await createUser({ email: "caregiver@example.com" });
    const session = await login(app, caregiver.email);

    const requested = await request(app)
      .post("/api/v1/auth/account-deletion")
      .set(auth(session.body.data.accessToken))
      .send({});
    expect(requested.status).toBe(200);
    expect(requested.body.data.reason).toBeNull();

    const adminLogin = await request(app).post("/api/v1/admin/auth/login").send({
      email: admin.email,
      password: PASSWORD,
    });
    const adminToken = adminLogin.body.data.accessToken as string;

    const rejected = await request(app)
      .post(`/api/v1/account-deletion-requests/${requested.body.data.id}/reject`)
      .set(auth(adminToken));
    expect(rejected.status).toBe(200);
    expect(rejected.body.message).toBe("Account deletion rejected");
    expect(rejected.body.data).toMatchObject({
      status: "rejected",
      reviewedById: admin.id,
      user: { id: caregiver.id, status: "active" },
    });

    const restored = await login(app, caregiver.email);
    expect(restored.status).toBe(200);
    expect(restored.body.data.user.id).toBe(caregiver.id);
  });

  it("rejects a second pending deletion request", async () => {
    const caregiver = await createUser({ email: "once@example.com" });
    const session = await login(app, caregiver.email);
    const token = session.body.data.accessToken as string;

    const first = await request(app).post("/api/v1/auth/account-deletion").set(auth(token)).send({});
    expect(first.status).toBe(200);

    await prisma.user.update({ where: { id: caregiver.id }, data: { status: "active" } });
    const againSession = await login(app, caregiver.email);
    const again = await request(app)
      .post("/api/v1/auth/account-deletion")
      .set(auth(againSession.body.data.accessToken))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.message).toContain("already pending");
  });
});
