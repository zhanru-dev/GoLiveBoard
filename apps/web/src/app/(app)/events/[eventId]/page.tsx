import type { Metadata } from "next";

import { LaunchControlPage } from "@/features/launch-control/launch-control-page";

export const metadata: Metadata = { title: "Launch Control" };

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ eventId: string }> }>) {
  const { eventId } = await params;
  return <LaunchControlPage eventId={eventId} />;
}
