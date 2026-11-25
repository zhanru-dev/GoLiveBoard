import type { Metadata } from "next";
import { Suspense } from "react";

import { DemoSignIn } from "@/features/auth/demo-sign-in";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  // Read when the page is rendered (every request), so one image serves the
  // demo environment and any other.
  const demoMode = process.env.DEMO_MODE === "true";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      {demoMode ? <DemoSignIn /> : null}
      {/* Suspense: the form reads the URL, which is only known in the browser. */}
      <Suspense>
        <SignInForm />
      </Suspense>
    </>
  );
}
