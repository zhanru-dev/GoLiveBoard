import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The design tokens of :root in globals.css, by name. */
function tokens(): Map<string, string> {
  const css = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");
  const root = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  return new Map(
    [...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name ?? "",
      (value ?? "").trim(),
    ]),
  );
}

type Rgb = readonly [number, number, number];

/** sRGB channels (0–1) of a `#rrggbb` token. */
function channels(value: string): Rgb {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (match === null) {
    throw new Error(`Not a #rrggbb colour: ${value}`);
  }
  const [, r = "", g = "", b = ""] = match;
  return [r, g, b].map(
    (hex) => Number.parseInt(hex, 16) / 255,
  ) as unknown as Rgb;
}

const linear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** `top` at `alpha` over `bottom`, as the browser composites it. */
function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return top.map(
    (channel, index) => alpha * channel + (1 - alpha) * (bottom[index] ?? 0),
  ) as unknown as Rgb;
}

/**
 * The contrast the design tokens promise (WCAG 2.2 AA): 4.5:1 for text
 * (1.4.3), 3:1 for what identifies a control or shows focus (1.4.11).
 */
describe("design token contrast", () => {
  const all = tokens();
  const colour = (name: string) => channels(all.get(name) ?? "missing");
  const background = colour("background");

  it.each([
    ["foreground", "background"],
    ["muted-foreground", "background"],
    ["muted-foreground", "muted"],
    ["subtle-foreground", "background"],
    ["subtle-foreground", "muted"],
    ["card-foreground", "card"],
    ["primary-foreground", "primary"],
    ["primary", "background"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
    ["destructive", "background"],
    ["success", "success-soft"],
    ["warning", "warning-soft"],
    ["danger", "danger-soft"],
    ["live-foreground", "live"],
    ["ink-foreground", "ink"],
    ["ink-foreground", "ink-panel"],
    ["ink-muted", "ink"],
    ["ink-muted", "ink-panel"],
  ])("keeps %s text on %s at 4.5:1 or more", (text, surface) => {
    expect(contrast(colour(text), colour(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it("draws a field's edge at 3:1 or more", () => {
    expect(contrast(colour("input"), background)).toBeGreaterThanOrEqual(3);
  });

  it("draws the focus ring at 3:1 or more, as components use it (half opaque)", () => {
    // ring-ring/50: the ring colour at 50% over the background.
    const ring = over(colour("ring"), 0.5, background);
    expect(contrast(ring, background)).toBeGreaterThanOrEqual(3);
  });
});
