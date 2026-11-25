import type { Metadata } from "next";

import { NewEventPage } from "@/features/events/new-event-page";

export const metadata: Metadata = { title: "New event" };

export default function Page() {
  return <NewEventPage />;
}
