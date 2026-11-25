import { describe, expect, it } from "vitest";

import {
  CreateEventRequest,
  END_AFTER_START_MESSAGE,
  ListEventsQuery,
  UpdateEventRequest,
} from "./events.js";

const valid = {
  title: "  Product launch  ",
  startsAt: "2026-12-01T18:00:00Z",
  endsAt: "2026-12-01T19:30:00Z",
  timeZone: "Europe/London",
};

describe("CreateEventRequest", () => {
  it("fills in optional fields and trims the title", () => {
    expect(CreateEventRequest.parse(valid)).toEqual({
      ...valid,
      title: "Product launch",
      description: "",
      ownerUserId: null,
      expectedAttendance: null,
    });
  });

  it.each([
    ["the same instant", "2026-12-01T18:00:00Z"],
    ["an earlier instant", "2026-12-01T17:59:59Z"],
  ])("rejects an end at %s as the start", (_label, endsAt) => {
    const result = CreateEventRequest.safeParse({ ...valid, endsAt });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["endsAt"],
        message: END_AFTER_START_MESSAGE,
      }),
    ]);
  });

  it.each(["Mars/Olympus_Mons", "GMT+25", ""])(
    "rejects the unknown time zone %j",
    (timeZone) => {
      expect(CreateEventRequest.safeParse({ ...valid, timeZone }).success).toBe(
        false,
      );
    },
  );

  it("rejects times with an offset instead of Z", () => {
    expect(
      CreateEventRequest.safeParse({
        ...valid,
        startsAt: "2026-12-01T18:00:00+01:00",
      }).success,
    ).toBe(false);
  });

  it.each([0, -5, 1.5, 100_001])(
    "rejects an expected attendance of %s",
    (expectedAttendance) => {
      expect(
        CreateEventRequest.safeParse({ ...valid, expectedAttendance }).success,
      ).toBe(false);
    },
  );
});

describe("UpdateEventRequest", () => {
  it("accepts clearing the owner", () => {
    expect(UpdateEventRequest.parse({ ownerUserId: null })).toEqual({
      ownerUserId: null,
    });
  });

  it("rejects an empty change", () => {
    expect(UpdateEventRequest.safeParse({}).success).toBe(false);
  });
});

describe("ListEventsQuery", () => {
  it("applies the default page size", () => {
    expect(ListEventsQuery.parse({})).toEqual({ limit: 25 });
  });

  it("turns one status or several into a list", () => {
    expect(ListEventsQuery.parse({ status: "LIVE" }).status).toEqual(["LIVE"]);
    expect(
      ListEventsQuery.parse({ status: ["DRAFT", "READY"] }).status,
    ).toEqual(["DRAFT", "READY"]);
  });

  it("coerces the limit from the query string and caps it at 100", () => {
    expect(ListEventsQuery.parse({ limit: "50" }).limit).toBe(50);
    expect(ListEventsQuery.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects a date range that ends before it starts", () => {
    const result = ListEventsQuery.safeParse({
      from: "2026-12-02T00:00:00Z",
      to: "2026-12-01T00:00:00Z",
    });

    expect(result.error?.issues[0]?.path).toEqual(["to"]);
  });
});
