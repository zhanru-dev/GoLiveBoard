import { describe, expect, it } from "vitest";

import { eventSlug, slugifyTitle } from "./slug.js";

describe("slugifyTitle", () => {
  it.each([
    ["Product launch", "product-launch"],
    ["Café Launch: 2026!", "cafe-launch-2026"],
    ["  --Q4 all-hands--  ", "q4-all-hands"],
    ["Ünïcödé Ångström", "unicode-angstrom"],
    ["🚀🚀", "event"],
    ["", "event"],
  ])("turns %j into %j", (title, slug) => {
    expect(slugifyTitle(title)).toBe(slug);
  });

  it("cuts a long title at a word boundary", () => {
    const slug = slugifyTitle(
      "The annual customer conference for operations teams in Europe and beyond",
    );

    expect(slug).toBe("the-annual-customer-conference-for-operations-teams-in");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("cuts a single very long word at the limit", () => {
    expect(slugifyTitle("a".repeat(80))).toBe("a".repeat(60));
  });
});

describe("eventSlug", () => {
  it("appends the suffix", () => {
    expect(eventSlug("Product launch", "k3x9q2mz7a")).toBe(
      "product-launch-k3x9q2mz7a",
    );
  });
});
