import type { ReactNode } from "react";

import { Providers } from "@/lib/providers";

/** Sign-in, sign-up, password reset and invitations: one centred card. */
export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <Providers>
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
        <p className="text-xl font-semibold">OpsPilot</p>
        {children}
      </main>
    </Providers>
  );
}
