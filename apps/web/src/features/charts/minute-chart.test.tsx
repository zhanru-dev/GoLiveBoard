import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MinuteChart } from "./minute-chart";

const points = [
  { minute: "2026-12-01T17:00:00.000Z", value: 3 },
  { minute: "2026-12-01T17:01:00.000Z", value: 5, marked: true },
  { minute: "2026-12-01T17:02:00.000Z", value: 2 },
];

describe("MinuteChart", () => {
  it("is one image, named and summarised for assistive technology", () => {
    render(
      <MinuteChart
        label="Audience"
        unit="viewers"
        points={points}
        timeZone="Europe/London"
      />,
    );

    const chart = screen.getByRole("img", { name: "Audience" });
    expect(chart).toHaveAccessibleDescription(
      "17:00 to 17:02: peak 5 viewers at 17:01, 2 in the last minute.",
    );
    expect(screen.getAllByTestId("incident-minute")).toHaveLength(1);
  });

  it("offers the same figures as a table", () => {
    render(
      <MinuteChart
        label="Audience"
        unit="viewers"
        points={points}
        timeZone="America/New_York"
      />,
    );

    const rows = screen.getAllByRole("row", { hidden: true });
    expect(rows.map((row) => row.textContent)).toEqual([
      "MinuteViewersIncident",
      "12:003",
      "12:015Yes",
      "12:022",
    ]);
  });

  it("says so when there is nothing yet", () => {
    render(
      <MinuteChart
        label="Audience"
        unit="viewers"
        points={[]}
        timeZone="UTC"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Audience" }),
    ).toHaveAccessibleDescription("No viewers yet.");
  });
});
