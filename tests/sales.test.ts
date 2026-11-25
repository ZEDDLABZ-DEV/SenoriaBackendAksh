import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

function salesBody(email = "sam.seller@example.com") {
  return {
    firstName: "Sam",
    lastName: "Seller",
    dateOfBirth: "1992-04-18",
    email,
    password: "sales-password",
    phone: "(604) 555-0177",
  };
}

async function adminToken() {
  const admin = await createUser({
    role: "ADMIN",
    email: "admin@example.com",
    firstName: "Ada",
    lastName: "Admin",
  });
  const response = await login(app, admin.email);
  return response.body.data.accessToken as string;
}

describe("sales accounts", () => {
  it("lets an admin create and list a sales account", async () => {
    const token = await adminToken();
    const created = await request(app).post("/api/v1/users/sales").set(auth(token)).send(salesBody());
    expect(created.status).toBe(200);
    expect(created.body.message).toBe("Sales account created");
    expect(created.body.data).toMatchObject({
      firstName: "Sam",
      lastName: "Seller",
      dateOfBirth: "1992-04-18",
      email: "sam.seller@example.com",
      phone: "(604) 555-0177",
      role: "SALES",
      status: "active",
    });
    expect(JSON.stringify(created.body)).not.toContain("passwordHash");
    expect(JSON.stringify(created.body)).not.toContain("sales-password");

    const listed = await request(app).get("/api/v1/users/sales").set(auth(token));
    expect(listed.status).toBe(200);
    expect(listed.body.data.data).toEqual([
      {
        id: created.body.data.id,
        firstName: "Sam",
        lastName: "Seller",
        dateOfBirth: "1992-04-18",
        email: "sam.seller@example.com",
        phone: "(604) 555-0177",
        role: "SALES",
        status: "active",
      },
    ]);

    const duplicate = await request(app)
      .post("/api/v1/users/sales")
      .set(auth(token))
      .send(salesBody("sam.seller@example.com"));
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.errors.email).toEqual(["Email is already in use"]);

    const caregiver = await createUser({ email: "caregiver@example.com" });
    const caregiverToken = (await login(app, caregiver.email)).body.data.accessToken as string;
    const blocked = await request(app).post("/api/v1/users/sales").set(auth(caregiverToken)).send(salesBody("other@example.com"));
    expect(blocked.status).toBe(403);
  });

  it("rejects an incomplete sales account", async () => {
    const token = await adminToken();
    const response = await request(app).post("/api/v1/users/sales").set(auth(token)).send({
      firstName: "Sam",
      lastName: "Seller",
      email: "sam.seller@example.com",
      password: "short",
    });
    expect(response.status).toBe(422);
    expect(response.body.errors.dateOfBirth).toEqual(expect.any(Array));
    expect(response.body.errors.phone).toEqual(expect.any(Array));
    expect(response.body.errors.password[0]).toContain("at least 6");
  });

  it("signs a sales account into a profile dashboard and keeps admin stats closed", async () => {
    const token = await adminToken();
    const created = await request(app).post("/api/v1/users/sales").set(auth(token)).send(salesBody());
    const signedIn = await login(app, "sam.seller@example.com", "sales-password");
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.user.role).toBe("SALES");
    const salesToken = signedIn.body.data.accessToken as string;
    const payload = jwt.decode(salesToken) as jwt.JwtPayload;
    expect(payload.sv).toBe(0);
    expect(payload.role).toBeUndefined();

    const dashboard = await request(app).get("/api/v1/sales/dashboard").set(auth(salesToken));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data).toEqual({
      id: created.body.data.id,
      firstName: "Sam",
      lastName: "Seller",
      dateOfBirth: "1992-04-18",
      email: "sam.seller@example.com",
      phone: "(604) 555-0177",
      role: "SALES",
    });

    const adminLogin = await request(app).post("/api/v1/admin/auth/login").send({
      email: "sam.seller@example.com",
      password: "sales-password",
    });
    expect(adminLogin.status).toBe(403);

    const stats = await request(app).get("/api/v1/dashboard/stats").set(auth(salesToken));
    expect(stats.status).toBe(403);
    const clients = await request(app).get("/api/v1/clients").set(auth(salesToken));
    expect(clients.status).toBe(403);
    const visits = await request(app)
      .get(`/api/v1/appointments/caregiver/${created.body.data.id}`)
      .set(auth(salesToken));
    expect(visits.status).toBe(403);

    const adminDashboard = await request(app).get("/api/v1/sales/dashboard").set(auth(token));
    expect(adminDashboard.status).toBe(403);
    const revoke = await request(app)
      .post(`/api/v1/users/sales/${created.body.data.id}/sessions/revoke`)
      .set(auth(salesToken));
    expect(revoke.status).toBe(403);
  });

  it("logs the salesperson out when the account is deactivated", async () => {
    const token = await adminToken();
    const created = await request(app).post("/api/v1/users/sales").set(auth(token)).send(salesBody());
    const signedIn = await login(app, "sam.seller@example.com", "sales-password");
    const salesToken = signedIn.body.data.accessToken as string;

    const deactivated = await request(app)
      .post(`/api/v1/users/sales/${created.body.data.id}/deactivate`)
      .set(auth(token));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.status).toBe("inactive");

    const dashboard = await request(app).get("/api/v1/sales/dashboard").set(auth(salesToken));
    expect(dashboard.status).toBe(401);
    expect(dashboard.body.code).toBe("UNAUTHENTICATED");

    const refreshed = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: signedIn.body.data.refreshToken,
    });
    expect(refreshed.status).toBe(401);

    const again = await login(app, "sam.seller@example.com", "sales-password");
    expect(again.status).toBe(401);

    const listed = await request(app).get("/api/v1/users/sales").set(auth(token));
    expect(listed.status).toBe(200);
    expect(listed.body.data.data).toEqual([
      expect.objectContaining({
        id: created.body.data.id,
        email: "sam.seller@example.com",
        status: "inactive",
      }),
    ]);

    const activeOnly = await request(app).get("/api/v1/users/sales?status=active").set(auth(token));
    expect(activeOnly.body.data.data).toEqual([]);
    const inactiveOnly = await request(app).get("/api/v1/users/sales?status=inactive").set(auth(token));
    expect(inactiveOnly.body.data.data).toEqual([
      expect.objectContaining({ id: created.body.data.id, status: "inactive" }),
    ]);
    const invalid = await request(app).get("/api/v1/users/sales?status=deleted").set(auth(token));
    expect(invalid.status).toBe(422);
    expect(invalid.body.errors.status).toEqual(["status must be active, inactive, or all"]);

    const caregiver = await createUser({ email: "caregiver@example.com" });
    const missing = await request(app)
      .post(`/api/v1/users/sales/${caregiver.id}/deactivate`)
      .set(auth(token));
    expect(missing.status).toBe(404);
  });

  it("revokes the current session and lets the salesperson sign in again", async () => {
    const token = await adminToken();
    const created = await request(app).post("/api/v1/users/sales").set(auth(token)).send(salesBody());
    const signedIn = await login(app, "sam.seller@example.com", "sales-password");
    const salesToken = signedIn.body.data.accessToken as string;

    const revoked = await request(app)
      .post(`/api/v1/users/sales/${created.body.data.id}/sessions/revoke`)
      .set(auth(token));
    expect(revoked.status).toBe(200);
    expect(revoked.body.message).toBe("Session revoked");
    expect(revoked.body.data.status).toBe("active");

    const dashboard = await request(app).get("/api/v1/sales/dashboard").set(auth(salesToken));
    expect(dashboard.status).toBe(401);

    const refreshed = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: signedIn.body.data.refreshToken,
    });
    expect(refreshed.status).toBe(401);

    const next = await login(app, "sam.seller@example.com", "sales-password");
    expect(next.status).toBe(200);
    const restored = await request(app)
      .get("/api/v1/sales/dashboard")
      .set(auth(next.body.data.accessToken));
    expect(restored.status).toBe(200);
    expect(restored.body.data.id).toBe(created.body.data.id);

    const changed = await request(app)
      .post(`/api/v1/users/sales/${created.body.data.id}/password`)
      .set(auth(token))
      .send({ password: "next-password" });
    expect(changed.status).toBe(200);
    const afterPassword = await request(app)
      .get("/api/v1/sales/dashboard")
      .set(auth(next.body.data.accessToken));
    expect(afterPassword.status).toBe(401);
    const oldPassword = await login(app, "sam.seller@example.com", "sales-password");
    expect(oldPassword.status).toBe(401);
    const newPassword = await login(app, "sam.seller@example.com", "next-password");
    expect(newPassword.status).toBe(200);
  });
});
