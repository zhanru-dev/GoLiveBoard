import type { Metadata } from "next";
import { Suspense } from "react";

import { AuditPage } from "@/features/audit/audit-page";

export const metadata: Metadata = { title: "Audit trail" };

export default function Page() {
  // It reads the query string, which needs a Suspense boundary.
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
