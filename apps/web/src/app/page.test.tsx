import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("introduces the product with one main heading", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "OpsPilot" }),
    ).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
