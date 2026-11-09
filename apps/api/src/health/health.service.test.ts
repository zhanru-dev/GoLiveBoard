import { Test } from "@nestjs/testing";
import { getLoggerToken } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";

import { HEALTH_INDICATORS, type HealthIndicator } from "./health-indicator.js";
import { HealthService, runCheck } from "./health.service.js";

const up = (name: string): HealthIndicator => ({
  name,
  check: () => Promise.resolve(),
});

const down = (name: string, error = new Error(`${name} refused`)) => ({
  name,
  check: () => Promise.reject(error),
});

/** Never settles and ignores its abort signal: the worst possible indicator. */
const hanging = (name: string): HealthIndicator => ({
  name,
  check: () => new Promise(() => undefined),
});

async function createService(indicators: readonly HealthIndicator[]) {
  const logger = { warn: vi.fn() };
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: HEALTH_INDICATORS, useValue: indicators },
      { provide: getLoggerToken(HealthService.name), useValue: logger },
    ],
  }).compile();
  return { service: moduleRef.get(HealthService), logger };
}

describe("HealthService.checkReadiness", () => {
  it("is ok when there is nothing to check", async () => {
    const { service } = await createService([]);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: "ok",
      checks: {},
    });
  });

  it("is ok when every dependency is up", async () => {
    const { service } = await createService([up("database"), up("valkey")]);

    const report = await service.checkReadiness();

    expect(report.status).toBe("ok");
    expect(report.checks).toEqual({
      database: { status: "up", durationMs: expect.any(Number) as number },
      valkey: { status: "up", durationMs: expect.any(Number) as number },
    });
  });

  it("is unavailable when any dependency is down", async () => {
    const { service } = await createService([up("database"), down("valkey")]);

    const report = await service.checkReadiness();

    expect(report.status).toBe("unavailable");
    expect(report.checks.database?.status).toBe("up");
    expect(report.checks.valkey?.status).toBe("down");
  });

  it("logs why a check failed, without putting the reason in the report", async () => {
    const error = new Error("connect ECONNREFUSED 10.0.3.7:6379");
    const { service, logger } = await createService([down("valkey", error)]);

    const report = await service.checkReadiness();

    expect(JSON.stringify(report)).not.toContain("10.0.3.7");
    expect(logger.warn).toHaveBeenCalledWith(
      { check: "valkey", err: error },
      "Health check failed",
    );
  });
});

describe("runCheck", () => {
  it("reports success", async () => {
    await expect(runCheck(up("database"), 100)).resolves.toEqual({ ok: true });
  });

  it("reports the error of a failed check", async () => {
    const error = new Error("refused");

    await expect(runCheck(down("database", error), 100)).resolves.toEqual({
      ok: false,
      error,
    });
  });

  it("gives up on a check that hangs, even if it ignores the abort signal", async () => {
    const startedAt = performance.now();

    const outcome = await runCheck(hanging("database"), 50);

    expect(outcome.ok).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("passes an abort signal that fires at the timeout", async () => {
    let received: AbortSignal | undefined;
    const indicator: HealthIndicator = {
      name: "database",
      check: (signal) => {
        received = signal;
        return new Promise(() => undefined);
      },
    };

    await runCheck(indicator, 20);

    expect(received?.aborted).toBe(true);
  });
});
