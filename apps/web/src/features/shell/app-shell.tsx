"use client";

import type { Me } from "@goliveboard/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/logo";
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
  const pathname = usePathname();
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

  const links = [
    { href: "/events", label: "Events" },
    { href: "/audit", label: "Audit trail" },
    { href: "/settings/team", label: "Team" },
    // Webhooks are the Owners' alone, in the API too.
    ...(me.activeWorkspace.role === "OWNER"
      ? [{ href: "/settings/integrations", label: "Integrations" }]
      : []),
  ];

  return (
    <MeProvider value={me}>
      {/* First on the page for keyboard users: past the navigation in one
          key (WCAG 2.4.1). Hidden until focused. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh flex-col bg-muted lg:flex-row">
        {/* A sidebar on wide screens; on a narrow screen or at high zoom a
            bar that wraps, so nothing scrolls sideways (WCAG 1.4.10). */}
        {/* The column runs the page's full height; the sidebar in it stays
            in view while the page scrolls. */}
        <div className="border-b bg-background lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-5 lg:overflow-y-auto lg:px-3.5 lg:py-5">
            <Link
              href="/events"
              className="flex items-center gap-2.5 px-1.5 font-bold"
            >
              <Logo className="size-6.5" />
              GoLiveBoard
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* The name includes the visible text (WCAG 2.5.3), so voice
                  users can say what they see. */}
                <Button
                  variant="outline"
                  className="h-auto max-w-60 justify-start gap-2.5 px-2.5 py-2 text-left lg:max-w-none"
                  aria-label={`Switch workspace: ${me.activeWorkspace.workspaceName}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent font-bold text-accent-foreground"
                  >
                    {me.activeWorkspace.workspaceName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {me.activeWorkspace.workspaceName}
                    </span>
                    <span className="text-xs font-normal text-subtle-foreground capitalize">
                      {me.activeWorkspace.role.toLowerCase()}
                    </span>
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
              className="flex flex-wrap gap-1 text-sm lg:flex-col lg:flex-nowrap lg:gap-0.5"
            >
              {links.map((link) => {
                const current = isCurrent(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "rounded-lg px-2.5 py-2",
                      current
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto lg:mt-auto lg:ml-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto gap-2.5 px-2 py-1.5 lg:w-full lg:justify-start"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
                    >
                      {initials(me.user.name)}
                    </span>
                    <span className="truncate">{me.user.name}</span>
                  </Button>
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
          </header>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {me.activeWorkspace.isDemo ? (
            <p
              role="note"
              className="border-b border-warning/20 bg-warning-soft px-6 py-2 text-center text-sm text-warning"
            >
              This is a shared demo workspace: anyone trying the demo can see
              what you enter, and everything is reset every night at 03:00 UK
              time.
            </p>
          ) : null}
          {/* Keyed by workspace: nothing from the previous one survives a switch. */}
          <main
            id="content"
            tabIndex={-1}
            key={me.activeWorkspace.workspaceId}
            className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8"
          >
            {switching || refreshing ? (
              <p role="status">Switching workspace…</p>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </MeProvider>
  );
}

/** Whether a link is for the page shown, or a page below it. */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** "Ada Lovelace" → "AL": two letters at most. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join("");
}
