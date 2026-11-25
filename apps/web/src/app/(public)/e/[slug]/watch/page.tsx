import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WatchRoom } from "@/features/live/watch-room";
import { getWatchInfo } from "@/lib/server-api";

interface Props {
  readonly params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  // A page for signed-in attendees: nothing to index or preview.
  robots: { index: false, follow: false },
};

/** The watch page (FR-RN-1), for attendees the event admits. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const info = await getWatchInfo(slug);
  if (info === null) {
    redirect(`/e/${encodeURIComponent(slug)}`);
  }
  return (
    <>
      <header className="grid gap-1">
        <p className="text-sm font-medium text-muted-foreground">OpsPilot</p>
        <h1 className="text-2xl font-semibold tracking-tight">{info.title}</h1>
      </header>
      <WatchRoom info={info} />
    </>
  );
}
