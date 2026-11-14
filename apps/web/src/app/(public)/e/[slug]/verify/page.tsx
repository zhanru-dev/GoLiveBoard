import type { Metadata } from "next";
import { Suspense } from "react";

import { VerifyAttendee } from "@/features/public/verify-attendee";

export const metadata: Metadata = {
  title: "Confirm your registration",
  robots: { index: false },
};

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Confirm your registration
      </h1>
      {/* Suspense: the token is in the URL fragment, known only in the browser. */}
      <Suspense>
        <VerifyAttendee slug={slug} />
      </Suspense>
    </>
  );
}
