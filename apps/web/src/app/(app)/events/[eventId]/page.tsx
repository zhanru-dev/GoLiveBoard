import type { Metadata } from "next";

import { LaunchControlPage } from "@/features/launch-control/launch-control-page";

export const metadata: Metadata = { title: "Launch Control" };

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ eventId: string }> }>) {
  const { eventId } = await params;
  // Read at request time, so one image serves every deployment. Compose
  // passes an unset variable as "", which means none.
  const demoStream = process.env.DEMO_STREAM_URL;
  return (
    <LaunchControlPage
      eventId={eventId}
      demoStreamUrl={demoStream === "" ? undefined : demoStream}
    />
  );
}
