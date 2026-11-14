import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OWNER, renderScreen } from "@/testing/render";

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("warns that the demo workspace is shared and reset every night", () => {
    const demo = {
      ...OWNER,
      activeWorkspace: {
        ...OWNER.activeWorkspace,
        workspaceName: "Northwind Events (demo)",
        role: "MANAGER" as const,
        isDemo: true,
      },
    };

    renderScreen(<AppShell me={demo}>Content</AppShell>);

    expect(screen.getByRole("note")).toHaveTextContent("shared demo workspace");
    expect(screen.getByRole("note")).toHaveTextContent(
      "reset every night at 03:00 UK time",
    );
  });

  it("shows no such warning in a real workspace", () => {
    renderScreen(<AppShell me={OWNER}>Content</AppShell>);

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
