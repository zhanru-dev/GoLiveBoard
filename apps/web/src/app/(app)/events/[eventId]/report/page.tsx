import type { Metadata } from "next";

import { ReportPage } from "@/features/reports/report-page";

export const metadata: Metadata = { title: "Report" };

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ eventId: string }> }>) {
  const { eventId } = await params;
  return <ReportPage eventId={eventId} />;
}
