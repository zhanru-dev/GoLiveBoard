import { screen, within } from "@testing-library/react";
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

  it("links to Integrations for Owners only, and to the audit trail for all", () => {
    const owner = renderScreen(<AppShell me={OWNER}>Page</AppShell>);
    const main = () => screen.getByRole("navigation", { name: "Main" });
    expect(
      within(main()).getByRole("link", { name: "Integrations" }),
    ).toHaveAttribute("href", "/settings/integrations");
    owner.unmount();

    renderScreen(
      <AppShell
        me={{
          ...OWNER,
          activeWorkspace: { ...OWNER.activeWorkspace, role: "MANAGER" },
        }}
      >
        Page
      </AppShell>,
    );
    expect(
      within(main()).queryByRole("link", { name: "Integrations" }),
    ).toBeNull();
    expect(
      within(main()).getByRole("link", { name: "Audit trail" }),
    ).toHaveAttribute("href", "/audit");
  });
});
