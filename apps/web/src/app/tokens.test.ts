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

/** sRGB channel (0–1) of a grey `oklch(L 0 0)`: OKLab's L is cube-root luminance. */
function greyChannel(value: string): number {
  const match = /^oklch\(([\d.]+) 0 0\)$/.exec(value);
  if (match === null) {
    throw new Error(`Not a grey token: ${value}`);
  }
  const luminance = Number(match[1]) ** 3;
  return luminance <= 0.0031308
    ? 12.92 * luminance
    : 1.055 * luminance ** (1 / 2.4) - 0.055;
}

const luminanceOf = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** WCAG contrast ratio between two sRGB greys. */
function contrast(a: number, b: number): number {
  const [light, dark] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * The contrast the design tokens promise (WCAG 2.2 AA): 4.5:1 for text
 * (1.4.3), 3:1 for what identifies a control or shows focus (1.4.11).
 * Measured on the page's background, white.
 */
describe("design token contrast", () => {
  const all = tokens();
  const grey = (name: string) => greyChannel(all.get(name) ?? "missing");
  const background = grey("background");

  it("keeps text at 4.5:1 or more", () => {
    for (const name of ["foreground", "muted-foreground", "card-foreground"]) {
      expect(contrast(grey(name), background), name).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("draws a field's edge at 3:1 or more", () => {
    expect(contrast(grey("input"), background)).toBeGreaterThanOrEqual(3);
  });

  it("draws the focus ring at 3:1 or more, as components use it (half opaque)", () => {
    // ring-ring/50: the ring colour at 50% over the background.
    const ring = 0.5 * grey("ring") + 0.5 * background;
    expect(contrast(ring, background)).toBeGreaterThanOrEqual(3);
  });
});
