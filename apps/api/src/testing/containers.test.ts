import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  POSTGRES_IMAGE,
  SEAWEEDFS_IMAGE,
  SEAWEEDFS_STORAGE_FLAGS,
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
