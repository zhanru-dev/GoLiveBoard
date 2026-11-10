import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POSTGRES_IMAGE, VALKEY_IMAGE } from "./containers.js";

const compose = readFileSync(
  new URL("../../../../docker-compose.yml", import.meta.url),
  "utf8",
);

describe("test container images", () => {
  it.each([POSTGRES_IMAGE, VALKEY_IMAGE])(
    "%s is the image docker-compose.yml runs",
    (image) => {
      expect(compose).toContain(`image: ${image}`);
    },
  );
});
