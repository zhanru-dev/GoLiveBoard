import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DemoInbox } from "@/features/public/demo-inbox";
import { Providers } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Demo inbox",
  robots: { index: false },
};

/** Demo mode only (FR-AUTH-5), like the API route behind it. */
export default function Page() {
  if (process.env.DEMO_MODE !== "true") {
    notFound();
  }
  return (
    <Providers>
      <h1 className="text-2xl font-semibold tracking-tight">Demo inbox</h1>
      <p className="text-muted-foreground">
        In the demo no email is really sent. The messages for the attendees you
        registered from this browser appear here, newest first.
      </p>
      <DemoInbox />
    </Providers>
  );
}
