import { describe, expect, it } from "vitest";
import {
  adminNoteForOther,
  ClosedSetError,
  parseProficiency,
  parseSeverity,
} from "../src/domain/enums";
import { presentVisit } from "../src/domain/visit";
import { errorHandler } from "../src/middleware/errorHandler";
import { redact } from "../src/lib/logger";
import { calendarDateInTimeZone, resolveTimeZone } from "../src/lib/timezone";

describe("closed sets", () => {
  it("accepts the decided severity and proficiency values", () => {
    for (const value of ["low", "moderate", "high", "other"]) {
      expect(parseSeverity(value)).toBe(value);
    }
    for (const value of ["native", "fluent", "intermediate", "basic", "other"]) {
      expect(parseProficiency(value)).toBe(value);
    }
  });

  it("rejects values outside the closed sets", () => {
    expect(() => parseSeverity("medium")).toThrow(ClosedSetError);
    expect(() => parseSeverity("critical")).toThrow(ClosedSetError);
    expect(() => parseProficiency("advanced")).toThrow(ClosedSetError);
  });

  it("requires an admin note only when the value is other", () => {
    expect(adminNoteForOther("other", "  observed at home  ", "severity")).toBe("observed at home");
    expect(adminNoteForOther("moderate", null, "severity")).toBeNull();
    expect(() => adminNoteForOther("other", "  ", "proficiency")).toThrow(ClosedSetError);
    expect(() => adminNoteForOther("native", "hidden", "proficiency")).toThrow(ClosedSetError);
  });
});

describe("timezone calendar dates", () => {
  it("uses America/Vancouver when the header is missing or invalid", () => {
    expect(resolveTimeZone(undefined)).toBe("America/Vancouver");
    expect(resolveTimeZone("")).toBe("America/Vancouver");
    expect(resolveTimeZone("Not/AZone")).toBe("America/Vancouver");
    expect(resolveTimeZone("America/Vancouver")).toBe("America/Vancouver");
  });

  it("keeps Vancouver and Auckland on opposite sides of the date line boundary", () => {
    const instant = new Date("2026-10-20T06:30:00.000Z");
    expect(calendarDateInTimeZone(instant, "America/Vancouver")).toBe("2026-10-19");
    expect(calendarDateInTimeZone(instant, "Pacific/Auckland")).toBe("2026-10-20");
    expect(calendarDateInTimeZone(new Date("2026-10-20T07:00:00.000Z"), "America/Vancouver")).toBe(
      "2026-10-20",
    );
  });
});

describe("visit presentation", () => {
  const base = {
    appointmentStatus: "scheduled",
    recordStatus: "active",
    scheduledDate: "2026-10-19",
    endDate: "2026-11-02",
    cancellationReason: null,
  };

  it("marks an untouched day inside the range as pending and active", () => {
    expect(presentVisit(base, [], "2026-10-19")).toMatchObject({
      completedToday: false,
      activeToday: true,
      dailyVisitStatus: "pending",
      checkInTime: null,
    });
  });

  it("keeps a future day inactive while a checked-in today stays pending", () => {
    expect(presentVisit(base, [], "2026-10-18").activeToday).toBe(false);
    const checkedIn = presentVisit(
      base,
      [
        {
          serviceDate: "2026-10-19",
          dailyVisitStatus: "pending",
          completed: false,
          checkInAt: new Date("2026-10-19T16:05:00.000Z"),
          checkOutAt: null,
        },
      ],
      "2026-10-19",
    );
    expect(checkedIn).toMatchObject({
      dailyVisitStatus: "pending",
      activeToday: true,
      completedToday: false,
      checkInTime: "2026-10-19T16:05:00.000Z",
    });
  });

  it("shows a past completed day without calling it completed today", () => {
    const presentation = presentVisit(
      { ...base, scheduledDate: "2026-10-18", endDate: "2026-10-18", appointmentStatus: "completed" },
      [
        {
          serviceDate: "2026-10-18",
          dailyVisitStatus: "completed",
          completed: true,
          checkInAt: new Date("2026-10-18T16:00:00.000Z"),
          checkOutAt: new Date("2026-10-18T18:00:00.000Z"),
        },
      ],
      "2026-10-19",
    );
    expect(presentation).toMatchObject({
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: "completed",
    });
  });

  it("cancels the visible day without turning record status into the visit state", () => {
    expect(
      presentVisit(
        { ...base, appointmentStatus: "cancelled", cancellationReason: "Family requested a different day." },
        [],
        "2026-10-19",
      ),
    ).toMatchObject({
      completedToday: false,
      activeToday: false,
      dailyVisitStatus: "cancelled",
      cancellationReason: "Family requested a different day.",
    });
  });
});

describe("redaction and server errors", () => {
  it("removes secrets from log metadata", () => {
    expect(redact({ password: "hunter2", accessToken: "abc", nested: { refreshToken: "def" } })).toEqual({
      password: "[redacted]",
      accessToken: "[redacted]",
      nested: { refreshToken: "[redacted]" },
    });
  });

  it("returns the documented 500 body without echoing the thrown message", () => {
    const response = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    errorHandler(
      new Error("password hunter2 token secret"),
      { method: "GET", path: "/api/v1/clients/1" } as never,
      response as never,
      (() => undefined) as never,
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      message: "Something went wrong. Please try again later.",
      code: "SERVER_ERROR",
      errors: {},
      error: {
        message: "Something went wrong. Please try again later.",
        code: "SERVER_ERROR",
        fields: {},
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
  });
});
