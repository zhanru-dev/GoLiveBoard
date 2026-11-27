import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The deploy builds its own images (arm64, from the commit), so what runs
 * is not the image CI checked: it must pass the same package check before
 * it is pushed (docs/security-review.md, "Container images").
 */
const WORKFLOW = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

describe("the deploy workflow", () => {
  it("checks each image's OS packages after building it and before pushing it", () => {
    const build = WORKFLOW.indexOf("docker build ");
    const check = WORKFLOW.indexOf('scripts/check-image-packages.sh "$image"');
    const push = WORKFLOW.indexOf('docker push "$image"');

    expect(build).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(build);
    expect(push).toBeGreaterThan(check);
  });
});
