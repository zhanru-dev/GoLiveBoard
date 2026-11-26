import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("introduces the product with one main heading", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Know your event is ready before you go live.",
      }),
    ).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("offers sign-up and sign-in outside the demo, and no demo", () => {
    vi.stubEnv("DEMO_MODE", "false");
    render(<HomePage />);

    expect(
      screen.getAllByRole("link", { name: "Create your workspace" })[0],
    ).toHaveAttribute("href", "/sign-up");
    expect(screen.queryByRole("button", { name: /Try the demo/ })).toBeNull();
  });

  it("puts the demo first in demo mode, and sign-up by invitation beside it", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("SIGN_UP_CODE_REQUIRED", "true");
    render(<HomePage />);

    expect(
      screen.getAllByRole("button", { name: /Try the demo/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "I have an invite code" }),
    ).toHaveAttribute("href", "/sign-up");
  });
});
