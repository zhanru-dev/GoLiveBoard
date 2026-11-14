import type { Metadata } from "next";
import { Suspense } from "react";

import { UnsubscribeForm } from "@/features/public/unsubscribe-form";

export const metadata: Metadata = {
  title: "Stop reminders",
  robots: { index: false },
};

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Stop reminders</h1>
      <p>You will still be registered; only the reminder emails stop.</p>
      <Suspense>
        <UnsubscribeForm />
      </Suspense>
    </>
  );
}
