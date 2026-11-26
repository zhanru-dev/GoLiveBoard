import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OWNER, renderScreen } from "@/testing/render";

import { AppShell, isCurrent } from "./app-shell";

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

  it("marks the link of the page shown, and of pages below it, but not of look-alikes", () => {
    expect(isCurrent("/events", "/events")).toBe(true);
    expect(isCurrent("/events/0195f0a0/ops", "/events")).toBe(true);
    expect(isCurrent("/eventsx", "/events")).toBe(false);
    expect(isCurrent("/settings/integrations", "/settings/team")).toBe(false);
  });

  it("shows only the workspace's name on its switch button, which its accessible name contains (WCAG 2.5.3)", () => {
    renderScreen(<AppShell me={OWNER}>Page</AppShell>);

    const button = screen.getByRole("button", { name: /^Switch workspace/ });
    expect(button).toHaveTextContent(/^Ada's workspace$/);
    expect(button).toHaveAccessibleName("Switch workspace: Ada's workspace");
  });
});
