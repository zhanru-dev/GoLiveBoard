import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderScreen } from "@/testing/render";

import { formatMonth, MonthBars } from "./month-bars";

describe("MonthBars", () => {
  it("draws a bar a month, summarised in words and as a table", () => {
    renderScreen(
      <MonthBars
        label="Attendees per month"
        unit="attendees"
        points={[
          { month: "2026-10", value: 2 },
          { month: "2026-11", value: 0 },
          { month: "2026-12", value: 5 },
        ]}
      />,
    );

    expect(screen.getAllByTestId("month-bar")).toHaveLength(3);
    expect(
      screen.getByRole("img", { name: "Attendees per month" }),
    ).toHaveAccessibleDescription(
      "7 attendees over 3 months; the most in Dec 2026, with 5.",
    );
    expect(screen.getByRole("cell", { name: "Nov 2026" })).toBeInTheDocument();
  });

  it("says when there is nothing to show", () => {
    renderScreen(
      <MonthBars
        label="Attendees per month"
        unit="attendees"
        points={[{ month: "2026-10", value: 0 }]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Attendees per month" }),
    ).toHaveAccessibleDescription("No attendees in these months.");
  });

  it("names a month in English", () => {
    expect(formatMonth("2027-01")).toBe("Jan 2027");
  });
});
