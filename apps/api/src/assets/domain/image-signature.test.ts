import { describe, expect, it } from "vitest";

import { detectImageType } from "./image-signature.js";

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((value) =>
      typeof value === "string"
        ? Array.from(value, (c) => c.charCodeAt(0))
        : [value],
    ),
  );

describe("detectImageType", () => {
  it.each([
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF"), "image/jpeg"],
    [
      "PNG",
      bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d),
      "image/png",
    ],
    ["WebP", bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 "), "image/webp"],
  ])("recognises %s", (_label, input, type) => {
    expect(detectImageType(input)).toBe(type);
  });

  it.each([
    ["HTML", bytes("<!doctype html>")],
    ["SVG, which can carry scripts", bytes("<svg xmlns=")],
    ["GIF", bytes("GIF89a", 0, 0, 0, 0, 0, 0)],
    ["a RIFF file that is not WebP", bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt ")],
    ["a truncated PNG signature", bytes(0x89, "PNG")],
    ["nothing", bytes()],
  ])("refuses %s", (_label, input) => {
    expect(detectImageType(input)).toBeUndefined();
  });
});
