import { describe, expect, it } from "vitest";

import { demoSeed } from "./demo-seed.js";

const NOW = new Date("2026-11-14T13:25:00Z");

describe("demoSeed", () => {
  const events = demoSeed(NOW);

  it("places events around the time it runs, on the hour", () => {
    const launch = events.find(
      ({ title }) => title === "Autumn product launch",
    );

    expect(launch?.startsAt.toISOString()).toBe("2026-11-17T14:00:00.000Z");
    for (const event of events) {
      expect(event.startsAt.getUTCMinutes()).toBe(0);
    }
  });

  it("moves with the day it runs, so the demo always looks current", () => {
    const later = demoSeed(new Date("2027-03-01T08:00:00Z"));

    expect(later.map(({ startsAt }) => startsAt.getTime())).not.toEqual(
      events.map(({ startsAt }) => startsAt.getTime()),
    );
  });

  it("ends every event after it starts (docs/03, section 5)", () => {
    for (const event of events) {
      expect(event.endsAt.getTime()).toBeGreaterThan(event.startsAt.getTime());
    }
  });

  it("seeds no READY or LIVE event, which would promise a recent stream check", () => {
    expect(events.map(({ status }) => status)).not.toEqual(
      expect.arrayContaining(["READY"]),
    );
    expect(events.map(({ status }) => status)).not.toEqual(
      expect.arrayContaining(["LIVE"]),
    );
  });

  it("keeps upcoming events in the future and finished ones in the past", () => {
    for (const event of events) {
      if (event.status === "DRAFT" || event.status === "CONFIGURING") {
        expect(event.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
      } else {
        expect(event.endsAt.getTime()).toBeLessThan(NOW.getTime());
      }
    }
  });

  it("leaves a blocker to clear in the event being prepared", () => {
    const launch = events.find(({ status }) => status === "CONFIGURING");

    expect(
      launch?.tasks.some(
        ({ isCritical, completedBy }) => isCritical && completedBy === null,
      ),
    ).toBe(true);
  });

  it("records who completed a task exactly when it has a completion time", () => {
    for (const { completedBy, completedAt } of events.flatMap(
      ({ tasks }) => tasks,
    )) {
      expect(completedBy === null).toBe(completedAt === null);
    }
  });

  it("gives an email-domain policy its domains and other modes none", () => {
    for (const { accessPolicy } of events) {
      if (accessPolicy !== null) {
        expect(accessPolicy.allowedDomains.length > 0).toBe(
          accessPolicy.mode === "EMAIL_DOMAIN",
        );
      }
    }
  });
});
