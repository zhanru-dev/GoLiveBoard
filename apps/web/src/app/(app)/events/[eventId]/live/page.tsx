import type { Metadata } from "next";

import { OpsRoomPage } from "@/features/ops-room/ops-room-page";

export const metadata: Metadata = { title: "Operations room" };

export default async function Page({
  params,
}: Readonly<{ params: Promise<{ eventId: string }> }>) {
  const { eventId } = await params;
  return <OpsRoomPage eventId={eventId} />;
}
