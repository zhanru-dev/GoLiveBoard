import type { Metadata } from "next";
import { Suspense } from "react";

import { AcceptInvitation } from "@/features/auth/accept-invitation";

export const metadata: Metadata = { title: "Join a workspace" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Join a workspace
      </h1>
      {/* Suspense: the form reads the URL, which is only known in the browser. */}
      <Suspense>
        <AcceptInvitation />
      </Suspense>
    </>
  );
}
