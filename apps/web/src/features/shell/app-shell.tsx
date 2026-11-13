"use client";

import type { Me } from "@opspilot/contracts";
import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
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

  async function switchTo(workspaceId: string) {
    try {
      await api("/me/active-workspace", {
        method: "PUT",
        body: { workspaceId },
      });
      router.refresh();
    } catch {
      toast.error("Could not switch workspace. Please try again.");
    }
  }

  async function signOut() {
    await api("/auth/sign-out", { method: "POST" }).catch(() => undefined);
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <MeProvider value={me}>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <Link href="/settings/team" className="font-semibold">
            OpsPilot
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" aria-label="Switch workspace">
                {me.activeWorkspace.workspaceName}
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
          <nav aria-label="Main" className="flex gap-4 text-sm">
            <Link href="/settings/team">Team</Link>
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
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </MeProvider>
  );
}
