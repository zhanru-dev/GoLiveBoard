import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FEATURE_GROUPS, searchFeatures } from "./features";
import { HelpPage } from "./help-page";

describe("searchFeatures", () => {
  it("lists everything without a query", () => {
    expect(searchFeatures("  ")).toEqual(FEATURE_GROUPS);
  });

  it("finds features by their keywords and words, all of them", () => {
    expect(
      searchFeatures("hmac").flatMap((g) => g.features.map((f) => f.name)),
    ).toEqual(["Webhooks"]);
    expect(
      searchFeatures("stream outage").flatMap((g) =>
        g.features.map((f) => f.name),
      ),
    ).toEqual(["Stream checks", "Incidents"]);
    expect(searchFeatures("nothing-like-this")).toEqual([]);
  });
});

describe("HelpPage", () => {
  it("narrows the map as the visitor types, and says how many it found", async () => {
    render(<HelpPage />);
    expect(
      screen.getByRole("heading", { name: "Webhooks" }),
    ).toBeInTheDocument();

    await userEvent
      .setup()
      .type(screen.getByLabelText("Search the features"), "erase");

    expect(screen.getByRole("status")).toHaveTextContent("1 feature found");
    expect(
      screen.getByRole("heading", { name: "Attendee privacy" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Webhooks" })).toBeNull();
  });
});
