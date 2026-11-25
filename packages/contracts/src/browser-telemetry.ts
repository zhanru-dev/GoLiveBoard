import { z } from "zod";

/**
 * The pages browsers report measurements for, as route templates: never a
 * real path (slugs and IDs stay in the browser), and only these, so no one
 * can grow the metrics' label sets by sending made-up paths. Anything else
 * is "other".
 */
export const BrowserRoute = z.enum([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/invitations/accept",
  "/events",
  "/events/new",
  "/events/:id",
  "/events/:id/live",
  "/events/:id/report",
  "/audit",
  "/settings/team",
  "/settings/integrations",
  "/e/:slug",
  "/e/:slug/verify",
  "/e/:slug/watch",
  "/demo-inbox",
  "/reminders/unsubscribe",
  "other",
]);
export type BrowserRoute = z.infer<typeof BrowserRoute>;

/** Core Web Vitals, measured on real visits (web-vitals). */
export const WebVital = z.discriminatedUnion("name", [
  z.object({
    kind: z.literal("web-vital"),
    /** Largest Contentful Paint and Interaction to Next Paint, in ms. */
    name: z.enum(["LCP", "INP"]),
    value: z.number().min(0).max(120_000),
    route: BrowserRoute,
  }),
  z.object({
    kind: z.literal("web-vital"),
    /** Cumulative Layout Shift, a score without a unit. */
    name: z.literal("CLS"),
    value: z.number().min(0).max(100),
    route: BrowserRoute,
  }),
]);
export type WebVital = z.infer<typeof WebVital>;

/**
 * The real-time connection could not be made or was lost: what the API
 * cannot see when the browser never reaches it.
 */
export const BrowserRealtimeFailure = z.object({
  kind: z.literal("realtime-failure"),
  reason: z.enum(["connect-failed", "lost"]),
  route: BrowserRoute,
});
export type BrowserRealtimeFailure = z.infer<typeof BrowserRealtimeFailure>;

/**
 * `POST /api/v1/browser-telemetry`: a few measurements from one page view,
 * sent with `navigator.sendBeacon`. No session, no personal data.
 */
export const BrowserTelemetryRequest = z.object({
  measurements: z
    .array(z.union([WebVital, BrowserRealtimeFailure]))
    .min(1)
    .max(10),
});
export type BrowserTelemetryRequest = z.infer<typeof BrowserTelemetryRequest>;
