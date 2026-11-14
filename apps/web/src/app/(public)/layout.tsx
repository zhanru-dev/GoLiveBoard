import type { ReactNode } from "react";

/**
 * Pages for attendees and the public: no staff session, no app shell, and
 * as little JavaScript as possible (the event page has a performance budget,
 * NFR-3).
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-10">
      {children}
    </main>
  );
}
