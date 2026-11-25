import type * as WebVitals from "web-vitals";

import type {
  BrowserRealtimeFailure,
  BrowserRoute,
  BrowserTelemetryRequest,
} from "@opspilot/contracts";

/*
 * Measurements from real visits (docs/06, section 7): Core Web Vitals, at
 * the 75th percentile as NFR-3 states them, and real-time connections that
 * fail, which the API cannot see when the browser never reaches it.
 * Gathered on the page and sent once it is hidden, with sendBeacon, so they
 * never compete with the visit. Types only from the contracts: the public
 * page's script budget has no room for Zod.
 */

type Measurement = BrowserTelemetryRequest["measurements"][number];

const ENDPOINT = "/api/v1/browser-telemetry";
const BATCH = 10;

/** The route template of a path: slugs and IDs never leave the browser. */
export function routeTemplate(pathname: string): BrowserRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [pattern, route] of ROUTES) {
    if (pattern.test(path)) {
      return route;
    }
  }
  return "other";
}

const SEGMENT = "[^/]+";
const ROUTES: readonly (readonly [RegExp, BrowserRoute])[] = [
  ...(
    [
      "/",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/reset-password",
      "/invitations/accept",
      "/events",
      "/events/new",
      "/audit",
      "/settings/team",
      "/settings/integrations",
      "/demo-inbox",
      "/reminders/unsubscribe",
    ] as const
  ).map((route) => [new RegExp(`^${route}$`), route] as const),
  [new RegExp(`^/events/${SEGMENT}$`), "/events/:id"],
  [new RegExp(`^/events/${SEGMENT}/live$`), "/events/:id/live"],
  [new RegExp(`^/events/${SEGMENT}/report$`), "/events/:id/report"],
  [new RegExp(`^/e/${SEGMENT}$`), "/e/:slug"],
  [new RegExp(`^/e/${SEGMENT}/verify$`), "/e/:slug/verify"],
  [new RegExp(`^/e/${SEGMENT}/watch$`), "/e/:slug/watch"],
];

interface Page {
  readonly location: { readonly pathname: string };
  readonly navigator: { sendBeacon?: (url: string, data: Blob) => boolean };
  readonly document: {
    readonly visibilityState: string;
    addEventListener(type: "visibilitychange", listener: () => void): void;
  };
  addEventListener(type: "pagehide", listener: () => void): void;
}

let collector: Collector | undefined;

/** Gathers measurements and sends them in batches. */
export class Collector {
  private queue: Measurement[] = [];
  private readonly failuresSent = new Set<BrowserRealtimeFailure["reason"]>();

  constructor(private readonly page: Page) {
    const flush = () => {
      this.flush();
    };
    page.document.addEventListener("visibilitychange", () => {
      if (page.document.visibilityState === "hidden") {
        flush();
      }
    });
    page.addEventListener("pagehide", flush);
  }

  vital(name: "LCP" | "INP" | "CLS", value: number): void {
    this.add({ kind: "web-vital", name, value, route: this.route() });
  }

  /** Once per reason per page view: a reconnect loop is one problem. */
  realtimeFailure(reason: BrowserRealtimeFailure["reason"]): void {
    if (this.failuresSent.has(reason)) {
      return;
    }
    this.failuresSent.add(reason);
    this.add({ kind: "realtime-failure", reason, route: this.route() });
  }

  flush(): void {
    if (this.queue.length === 0) {
      return;
    }
    const body: BrowserTelemetryRequest = { measurements: this.queue };
    this.queue = [];
    this.page.navigator.sendBeacon?.(
      ENDPOINT,
      new Blob([JSON.stringify(body)], { type: "application/json" }),
    );
  }

  private add(measurement: Measurement): void {
    this.queue.push(measurement);
    // Web Vitals reports its final values as the page is hidden, possibly
    // after this collector's own flush for that moment: once hidden, what
    // arrives goes out at once.
    if (
      this.queue.length >= BATCH ||
      this.page.document.visibilityState === "hidden"
    ) {
      this.flush();
    }
  }

  private route(): BrowserRoute {
    return routeTemplate(this.page.location.pathname);
  }
}

/**
 * Starts measuring this page view (instrumentation-client.ts): the Web
 * Vitals library reports each vital when its value is final, at the latest
 * when the page is hidden.
 */
export async function startBrowserTelemetry(
  page: Page & Window,
  vitals: Promise<typeof WebVitals> = import("web-vitals"),
): Promise<void> {
  const started = new Collector(page);
  collector = started;
  const { onCLS, onINP, onLCP } = await vitals;
  onLCP(({ value }) => {
    started.vital("LCP", value);
  });
  onINP(({ value }) => {
    started.vital("INP", value);
  });
  onCLS(({ value }) => {
    started.vital("CLS", value);
  });
}

/** Reports a real-time connection that failed or was lost (use-live.ts). */
export function reportRealtimeFailure(
  reason: BrowserRealtimeFailure["reason"],
): void {
  collector?.realtimeFailure(reason);
}
