import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * infra/deploy/docker-compose.aws.yml, the application on the AWS host
 * (docs/06, section 4): limits that keep one container, or an attack on
 * it, from taking the host or its disk down.
 */
const compose = parse(
  readFileSync(
    fileURLToPath(
      new URL("../infra/deploy/docker-compose.aws.yml", import.meta.url),
    ),
    "utf8",
  ),
  { merge: true },
);

/** A t4g.small (infra/terraform/environments/demo, instance_type). */
const HOST_MIB = 2048;
/** What the system, the SSM agent and Docker itself need. */
const SYSTEM_MIB = 384;

const services = Object.entries(compose.services);
/** Services that run all the time; migrate runs alone, before them. */
const running = services.filter(
  ([, service]) => service.profiles === undefined,
);

function mebibytes(limit) {
  const match = /^(\d+)([mg])$/.exec(String(limit));
  if (match === null) {
    throw new Error(`"${String(limit)}" is not a size like 512m or 1g`);
  }
  return Number(match[1]) * (match[2] === "g" ? 1024 : 1);
}

describe("docker-compose.aws.yml", () => {
  it.each(services)("%s has memory, CPU and process limits", (_, service) => {
    expect(mebibytes(service.mem_limit)).toBeGreaterThan(0);
    expect(service.cpus).toBeGreaterThan(0);
    expect(service.cpus).toBeLessThanOrEqual(2);
    expect(service.pids_limit).toBeGreaterThan(0);
  });

  it.each(services)("%s rotates its logs", (_, service) => {
    expect(service.logging).toEqual({
      driver: "json-file",
      options: { "max-size": "10m", "max-file": "3" },
    });
  });

  it("leaves the host enough memory when every container is at its limit", () => {
    const total = running.reduce(
      (sum, [, service]) => sum + mebibytes(service.mem_limit),
      0,
    );

    expect(total).toBeLessThanOrEqual(HOST_MIB - SYSTEM_MIB);
  });

  it("refuses writes when Valkey is full, rather than evicting queue keys, below its container's limit", () => {
    const { command, mem_limit: limit } = compose.services.valkey;
    const option = (name) => command[command.indexOf(name) + 1];

    expect(option("--maxmemory-policy")).toBe("noeviction");
    expect(mebibytes(option("--maxmemory").replace("mb", "m"))).toBeLessThan(
      mebibytes(limit),
    );
  });
});
