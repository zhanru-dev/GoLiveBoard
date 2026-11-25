import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  POSTGRES_IMAGE,
  SEAWEEDFS_IMAGE,
  SEAWEEDFS_STORAGE_FLAGS,
  startRetryingPortBinding,
  VALKEY_IMAGE,
} from "./containers.js";

const read = (file: string) =>
  readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8");
const compose = read("docker-compose.yml");

describe("test container images", () => {
  it.each([POSTGRES_IMAGE, VALKEY_IMAGE, SEAWEEDFS_IMAGE])(
    "%s is the image docker-compose.yml runs",
    (image) => {
      expect(compose).toContain(`image: ${image}`);
    },
  );
});

describe("SeaweedFS storage flags", () => {
  it.each(["docker-compose.yml", "docker-compose.prod.yml"])(
    "%s starts SeaweedFS with the flags the tests use",
    (file) => {
      const text = read(file);
      for (const flag of SEAWEEDFS_STORAGE_FLAGS) {
        expect(text).toContain(`- ${flag}`);
      }
    },
  );
});

describe("startRetryingPortBinding", () => {
  const portsNotBound = new Error(
    "Timed out after 30000ms while waiting for container ports to be bound to the host",
  );

  it("starts again once when the ports were not bound in time", async () => {
    const start = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(portsNotBound)
      .mockResolvedValueOnce("started");

    await expect(startRetryingPortBinding(start)).resolves.toBe("started");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second attempt, and never retries other failures", async () => {
    const twice = vi.fn(() => Promise.reject(portsNotBound));
    const other = vi.fn(() => Promise.reject(new Error("no such image")));

    await expect(startRetryingPortBinding(twice)).rejects.toBe(portsNotBound);
    await expect(startRetryingPortBinding(other)).rejects.toThrow(
      "no such image",
    );
    expect(twice).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });
});
