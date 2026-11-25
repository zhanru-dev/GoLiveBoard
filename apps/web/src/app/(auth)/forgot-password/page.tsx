import type { Metadata } from "next";
import { Suspense } from "react";

import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Reset your password
      </h1>
      {/* Suspense: the form reads the URL, which is only known in the browser. */}
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </>
  );
}
