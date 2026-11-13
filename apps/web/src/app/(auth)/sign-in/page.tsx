import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      {/* Suspense: the form reads the URL, which is only known in the browser. */}
      <Suspense>
        <SignInForm />
      </Suspense>
    </>
  );
}
