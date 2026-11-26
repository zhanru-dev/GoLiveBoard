"use client";

import type { Me } from "@goliveboard/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";

import { MeProvider } from "./me-context";

export function AppShell({
  me,
  children,
}: Readonly<{ me: Me; children: ReactNode }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  /**
   * The page's content is hidden while switching, so nothing can fetch for
   * the old workspace in the meantime; requests already in flight are
   * cancelled, and every cached answer is dropped once the session has
   * moved. The server then renders the page for the new workspace.
   */
  async function switchTo(workspaceId: string) {
    setSwitching(true);
    try {
      await queryClient.cancelQueries();
      await api("/me/active-workspace", {
        method: "PUT",
        body: { workspaceId },
      });
      queryClient.clear();
      startRefresh(() => {
        router.refresh();
      });
    } catch {
      toast.error("Could not switch workspace. Please try again.");
    } finally {
      setSwitching(false);
    }
  }

  async function signOut() {
    await api("/auth/sign-out", { method: "POST" }).catch(() => undefined);
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <MeProvider value={me}>
      {/* First on the page for keyboard users: past the header in one key
          (WCAG 2.4.1). Hidden until focused. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        Skip to content
      </a>
      <header className="border-b">
        {/* Wraps on a narrow screen or at high zoom, so nothing scrolls
            sideways (WCAG 1.4.10). */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/events" className="font-semibold">
            GoLiveBoard
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The name includes the visible text (WCAG 2.5.3), so voice
                  users can say what they see. */}
              <Button
                variant="ghost"
                className="max-w-56"
                aria-label={`Switch workspace: ${me.activeWorkspace.workspaceName}`}
              >
                <span className="truncate">
                  {me.activeWorkspace.workspaceName}
                </span>
                <ChevronsUpDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {me.memberships.map((membership) => (
                <DropdownMenuItem
                  key={membership.workspaceId}
                  disabled={
                    membership.workspaceId === me.activeWorkspace.workspaceId
                  }
                  onSelect={() => void switchTo(membership.workspaceId)}
                >
                  {membership.workspaceName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <nav
            aria-label="Main"
            className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
          >
            <Link href="/events">Events</Link>
            <Link href="/audit">Audit trail</Link>
            <Link href="/settings/team">Team</Link>
            {/* Webhooks are the Owners' alone, in the API too. */}
            {me.activeWorkspace.role === "OWNER" ? (
              <Link href="/settings/integrations">Integrations</Link>
            ) : null}
          </nav>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">{me.user.name}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {me.user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      {me.activeWorkspace.isDemo ? (
        <p
          role="note"
          className="border-b bg-amber-50 px-6 py-2 text-center text-sm text-amber-950"
        >
          This is a shared demo workspace: anyone trying the demo can see what
          you enter, and everything is reset every night at 03:00 UK time.
        </p>
      ) : null}
      {/* Keyed by workspace: nothing from the previous one survives a switch. */}
      <main
        id="content"
        tabIndex={-1}
        key={me.activeWorkspace.workspaceId}
        className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
      >
        {switching || refreshing ? (
          <p role="status">Switching workspace…</p>
        ) : (
          children
        )}
      </main>
    </MeProvider>
  );
}
