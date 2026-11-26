import { BrowserRoute, BrowserTelemetryRequest } from "@goliveboard/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  Collector,
  realtimeFailureReporter,
  routeTemplate,
  startBrowserTelemetry,
} from "./browser-telemetry";

/** A page: where it is, its beacons, and its visibility, driven by the test. */
function fakePage(pathname = "/e/product-launch-k3x9q2mz7a") {
  const beacons: unknown[] = [];
  const listeners = new Map<string, (() => void)[]>();
  const on = (type: string, listener: () => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  };
  const page = {
    location: { pathname },
    navigator: {
      sendBeacon: (url: string, data: Blob) => {
        expect(url).toBe("/api/v1/browser-telemetry");
        expect(data.type).toBe("application/json");
        beacons.push(data);
        return true;
      },
    },
    document: { visibilityState: "visible", addEventListener: on },
    addEventListener: on,
  };
  const hide = () => {
    page.document.visibilityState = "hidden";
    for (const listener of listeners.get("visibilitychange") ?? []) listener();
  };
  const sent = async () =>
    Promise.all(
      beacons.map(async (blob) =>
        BrowserTelemetryRequest.parse(JSON.parse(await (blob as Blob).text())),
      ),
    );
  return { page, hide, sent };
}

describe("routeTemplate", () => {
  it.each([
    ["/", "/"],
    ["/sign-in", "/sign-in"],
    ["/sign-up", "/sign-up"],
    ["/forgot-password", "/forgot-password"],
    ["/reset-password", "/reset-password"],
    ["/invitations/accept", "/invitations/accept"],
    ["/events", "/events"],
    ["/events/new", "/events/new"],
    ["/events/0195f0a0-0000-7000-8000-000000000001", "/events/:id"],
    ["/events/0195f0a0-0000-7000-8000-000000000001/live", "/events/:id/live"],
    [
      "/events/0195f0a0-0000-7000-8000-000000000001/report",
      "/events/:id/report",
    ],
    ["/audit", "/audit"],
    ["/settings/team", "/settings/team"],
    ["/settings/integrations", "/settings/integrations"],
    ["/e/product-launch-k3x9q2mz7a", "/e/:slug"],
    ["/e/product-launch-k3x9q2mz7a/verify", "/e/:slug/verify"],
    ["/e/product-launch-k3x9q2mz7a/watch/", "/e/:slug/watch"],
    ["/demo-inbox", "/demo-inbox"],
    ["/reminders/unsubscribe", "/reminders/unsubscribe"],
    ["/somewhere/else", "other"],
  ])("names %s as %s", (path, route) => {
    expect(routeTemplate(path)).toBe(route);
  });

  it("covers every route the API takes", () => {
    const named = new Set(
      [
        "/",
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/invitations/accept",
        "/events",
        "/events/new",
        "/events/1",
        "/events/1/live",
        "/events/1/report",
        "/audit",
        "/settings/team",
        "/settings/integrations",
        "/e/s",
        "/e/s/verify",
        "/e/s/watch",
        "/demo-inbox",
        "/reminders/unsubscribe",
        "/x/y",
      ].map(routeTemplate),
    );
    expect([...named].sort()).toEqual([...BrowserRoute.options].sort());
  });
});

describe("Collector", () => {
  it("sends what it gathered once the page is hidden, as the API takes it, with no slug", async () => {
    const { page, hide, sent } = fakePage();
    const collector = new Collector(page);

    collector.vital("LCP", 812.4);
    collector.vital("CLS", 0.02);
    expect(await sent()).toEqual([]);
    hide();

    const requests = await sent();
    expect(requests).toEqual([
      {
        measurements: [
          { kind: "web-vital", name: "LCP", value: 812.4, route: "/e/:slug" },
          { kind: "web-vital", name: "CLS", value: 0.02, route: "/e/:slug" },
        ],
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("product-launch");
  });

  it("gives Web Vitals to the page the document was loaded on, after a move within the app", async () => {
    const { page, hide, sent } = fakePage("/e/product-launch-k3x9q2mz7a");
    const collector = new Collector(page);

    // The visitor goes on to the watch page without a reload; the first
    // page's largest paint is reported only when the tab is hidden.
    page.location.pathname = "/e/product-launch-k3x9q2mz7a/watch";
    collector.vital("LCP", 812);
    hide();

    expect((await sent())[0]?.measurements).toEqual([
      { kind: "web-vital", name: "LCP", value: 812, route: "/e/:slug" },
    ]);
  });

  it("gives a real-time failure to the page it happened on", async () => {
    const { page, hide, sent } = fakePage("/e/product-launch-k3x9q2mz7a");
    const collector = new Collector(page);

    page.location.pathname = "/e/product-launch-k3x9q2mz7a/watch";
    collector.realtimeFailure("lost");
    hide();

    expect((await sent())[0]?.measurements).toEqual([
      { kind: "realtime-failure", reason: "lost", route: "/e/:slug/watch" },
    ]);
  });

  it("sends a full batch at once, without waiting for the page to be hidden", async () => {
    const { page, sent } = fakePage();
    const collector = new Collector(page);

    for (let index = 0; index < 10; index++) {
      collector.vital("INP", 40 + index);
    }

    expect((await sent())[0]?.measurements).toHaveLength(10);
  });
});

describe("startBrowserTelemetry", () => {
  it("records LCP, INP and CLS as the Web Vitals library reports them", async () => {
    const { page, hide, sent } = fakePage();
    const report =
      (value: number) => (callback: (metric: { value: number }) => void) => {
        callback({ value });
      };
    const vitals = {
      onLCP: vi.fn(report(900)),
      onINP: vi.fn(report(64)),
      onCLS: vi.fn(report(0.01)),
    };

    await startBrowserTelemetry(
      page as never,
      Promise.resolve(vitals as never),
    );
    hide();

    expect((await sent())[0]?.measurements).toEqual([
      { kind: "web-vital", name: "LCP", value: 900, route: "/e/:slug" },
      { kind: "web-vital", name: "INP", value: 64, route: "/e/:slug" },
      { kind: "web-vital", name: "CLS", value: 0.01, route: "/e/:slug" },
    ]);
  });
});

describe("realtimeFailureReporter", () => {
  it("reports each reason once per page view, and again in the next one", () => {
    const reported: string[] = [];
    const firstView = realtimeFailureReporter((reason) =>
      reported.push(reason),
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      firstView("connect-failed");
    }
    firstView("lost");
    firstView("lost");

    // The visitor comes back to the watch page: a new connection, a new view.
    const nextView = realtimeFailureReporter((reason) => reported.push(reason));
    nextView("lost");

    expect(reported).toEqual(["connect-failed", "lost", "lost"]);
  });
});
