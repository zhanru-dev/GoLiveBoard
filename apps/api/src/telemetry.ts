/**
 * Loaded before the application (`node --import ./dist/telemetry.js
 * dist/main.js`), so the libraries it imports are instrumented (ADR-0011).
 *
 * The hook lets OpenTelemetry patch ES modules as they load. It is
 * registered before anything else is imported, and the SDK is imported
 * after it.
 */
import { register } from "node:module";
import { basename } from "node:path";

// The hook OpenTelemetry supports for ES modules (its esm-support guide).
// Node.js 26 prefers module.registerHooks(), which OpenTelemetry's
// instrumentation does not support yet.
// eslint-disable-next-line @typescript-eslint/no-deprecated
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const { startTelemetry, telemetrySettings } =
  await import("./observability/telemetry.js");

const entry = basename(process.argv[1] ?? "");
startTelemetry(
  telemetrySettings(process.env, entry.startsWith("worker") ? "worker" : "api"),
);
