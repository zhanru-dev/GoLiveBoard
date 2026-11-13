import type { Metadata } from "next";
import { Suspense } from "react";

import { SignUpForm } from "@/features/auth/sign-up-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Create your workspace
      </h1>
      {/* Suspense: the form reads the URL, which is only known in the browser. */}
      <Suspense>
        <SignUpForm />
      </Suspense>
    </>
  );
}
