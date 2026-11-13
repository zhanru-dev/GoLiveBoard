import type { ReactNode } from "react";

import { RestoreSession } from "@/features/auth/restore-session";
import { AppShell } from "@/features/shell/app-shell";
import { Providers } from "@/lib/providers";
import { getMe } from "@/lib/server-api";

/** The staff app. The session is checked on the server before anything renders. */
export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const me = await getMe();
  return (
    <Providers>
      {me === null ? (
        <RestoreSession />
      ) : (
        <AppShell me={me}>{children}</AppShell>
      )}
    </Providers>
  );
}
