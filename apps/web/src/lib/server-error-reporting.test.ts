import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Starts reporting in a fresh Node.js process, as the web server does, and
 * leaves a promise rejection unhandled. Runs the TypeScript source directly
 * (Node.js strips the types); the hook resolves its extensionless imports
 * the way the bundler does (only in our
 * own source: packages resolve as usual).
 */
const CHILD = `
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    const ours =
      specifier.startsWith(".") &&
      context.parentURL?.includes("/node_modules/") === false &&
      !/\\.[cm]?[jt]sx?$/.test(specifier);
    return next(ours ? specifier + ".ts" : specifier, context);
  },
});
const { initServerErrorReporting } = await import(process.env.MODULE_URL);
const on = initServerErrorReporting({
  // Nothing listens there: sending fails at once.
  SENTRY_DSN: "https://public@127.0.0.1:9/1",
  SENTRY_ENVIRONMENT: "test",
});
console.log("REPORTING_ON=" + String(on));
// Sentry turns Next.js's fetch spans off when it sets up OpenTelemetry.
console.log("NEXT_FETCH_SPANS_OFF=" + String(process.env.NEXT_OTEL_FETCH_DISABLED));
const { trace } = await import("@opentelemetry/api");
console.log("TRACER_PROVIDER=" + trace.getTracerProvider().constructor.name);
void Promise.reject(new Error("Nobody handles this"));
setTimeout(() => console.log("PROCESS_STILL_ALIVE"), 4000);
`;

function runChild(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", CHILD],
      {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          MODULE_URL: pathToFileURL(
            join(import.meta.dirname, "server-error-reporting.ts"),
          ).href,
        },
        cwd: import.meta.dirname,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, output });
    });
  });
}

describe("initServerErrorReporting", () => {
  it("ends the web server after an unhandled rejection, as the API does", async () => {
    const { code, output } = await runChild();

    expect(output).toContain("REPORTING_ON=true");
    expect(output).not.toContain("PROCESS_STILL_ALIVE");
    expect(code, output).not.toBe(0);
  }, 20_000);

  it("leaves tracing to OpenTelemetry: no tracer provider of Sentry's, Next.js's fetch spans on", async () => {
    const { output } = await runChild();

    expect(output).toContain("NEXT_FETCH_SPANS_OFF=undefined");
    expect(output).not.toMatch(/TRACER_PROVIDER=Sentry/);
  }, 20_000);
});
