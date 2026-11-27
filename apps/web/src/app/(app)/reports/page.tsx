import type { Metadata } from "next";

import { OverviewPage } from "@/features/reports/overview-page";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <OverviewPage />;
}
