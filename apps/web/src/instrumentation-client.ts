import { startBrowserTelemetry } from "./lib/browser-telemetry";
import { startErrorReporting } from "./lib/lazy-error-reporting";

// Error reporting, listening from the very start: Next.js runs this before
// the app hydrates, and an error caught during the first render must not
// slip past (lazy-error-reporting.ts).
startErrorReporting(window, document, () => import("@sentry/nextjs"));

// Web Vitals from real visits (docs/06, section 7); started at once, as
// the largest paint may come before the page has finished loading.
void startBrowserTelemetry(window);
