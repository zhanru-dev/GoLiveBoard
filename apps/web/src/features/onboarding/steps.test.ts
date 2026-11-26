import { describe, expect, it } from "vitest";

import { gettingStartedSteps, type Progress } from "./steps";

const NEW: Progress = {
  role: "OWNER",
  events: [],
  members: 1,
  webhooks: 0,
  openedOpsRoom: false,
  openedPublicPage: false,
};
const done = (progress: Progress) =>
  Object.fromEntries(gettingStartedSteps(progress).map((s) => [s.id, s.done]));

describe("gettingStartedSteps", () => {
  it("gives a new Owner every step, none done, starting with a first event", () => {
    const steps = gettingStartedSteps(NEW);

    expect(steps.map((s) => s.id)).toEqual([
      "event",
      "ready",
      "team",
      "ops-room",
      "public-page",
      "webhook",
    ]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps.find((s) => s.id === "ready")?.href).toBe("/events/new");
  });

  it("ticks each step from what has really been done", () => {
    expect(
      done({
        ...NEW,
        events: [{ id: "e1", slug: "launch", status: "COMPLETED" }],
        members: 2,
        webhooks: 1,
        openedOpsRoom: true,
        openedPublicPage: true,
      }),
    ).toEqual({
      event: true,
      ready: true,
      team: true,
      "ops-room": true,
      "public-page": true,
      webhook: true,
    });
  });

  it("counts an event as made ready only once it reached Ready", () => {
    expect(
      done({ ...NEW, events: [{ id: "e1", slug: "l", status: "CONFIGURING" }] })
        .ready,
    ).toBe(false);
    expect(
      done({ ...NEW, events: [{ id: "e1", slug: "l", status: "READY" }] })
        .ready,
    ).toBe(true);
  });

  it("points at the first event's pages once there is one", () => {
    const steps = gettingStartedSteps({
      ...NEW,
      events: [{ id: "e1", slug: "launch", status: "DRAFT" }],
    });

    expect(steps.find((s) => s.id === "ready")?.href).toBe("/events/e1");
    expect(steps.find((s) => s.id === "ops-room")?.href).toBe(
      "/events/e1/live",
    );
    expect(steps.find((s) => s.id === "public-page")).toMatchObject({
      href: "/e/launch",
      external: true,
    });
  });

  it("leaves out the Owners' steps for a Manager, and every step for an Analyst", () => {
    expect(
      gettingStartedSteps({ ...NEW, role: "MANAGER" }).map((s) => s.id),
    ).toEqual(["event", "ready", "ops-room", "public-page"]);
    expect(gettingStartedSteps({ ...NEW, role: "ANALYST" })).toEqual([]);
  });
});
