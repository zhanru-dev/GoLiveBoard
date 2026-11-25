import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      {/* Suspense: the form reads the URL, which is only known in the browser. */}
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </>
  );
}
