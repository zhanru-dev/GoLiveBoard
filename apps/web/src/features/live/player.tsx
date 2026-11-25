"use client";

import type { PublicEventStatus, WatchInfo } from "@opspilot/contracts";
import { useEffect, useRef, useState } from "react";

const HLS_TYPE = "application/vnd.apple.mpegurl";

/**
 * The stream once the event is live (FR-RN-1), the holding slate before.
 * Safari plays HLS itself; elsewhere hls.js is loaded, and only then: it
 * is the page's largest library.
 */
export function Player({
  status,
  streamUrl,
  slate,
  title,
}: Readonly<{
  status: PublicEventStatus;
  streamUrl: string | null;
  slate: WatchInfo["slate"];
  title: string;
}>) {
  if (status === "LIVE" && streamUrl !== null) {
    return <StreamVideo url={streamUrl} title={title} />;
  }
  return (
    <figure className="grid aspect-video place-items-center overflow-hidden rounded-lg border bg-muted">
      {slate === null ? (
        <figcaption className="p-6 text-center text-muted-foreground">
          {CAPTIONS[status]}
        </figcaption>
      ) : (
        <>
          {/* A presigned link to object storage, not an optimisable asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slate.url}
            alt={`${title}: ${CAPTIONS[status]}`}
            className="size-full object-contain"
          />
        </>
      )}
    </figure>
  );
}

const CAPTIONS: Readonly<Record<PublicEventStatus, string>> = {
  UPCOMING: "The event has not started yet. The stream starts here.",
  LIVE: "The stream is starting.",
  ENDED: "The event has ended.",
  CANCELLED: "The event has been cancelled.",
};

function StreamVideo({ url, title }: Readonly<{ url: string; title: string }>) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (element === null) {
      return;
    }
    if (element.canPlayType(HLS_TYPE) !== "") {
      element.src = url;
      return;
    }
    let destroy: (() => void) | undefined;
    let cancelled = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) {
        return;
      }
      if (!Hls.isSupported()) {
        setFailed(true);
        return;
      }
      // No worker: the page's CSP runs scripts with its nonce only.
      const hls = new Hls({ enableWorker: false });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setFailed(true);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(element);
      destroy = () => {
        hls.destroy();
      };
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);

  return (
    <div className="grid gap-2">
      <video
        ref={video}
        controls
        autoPlay
        muted
        playsInline
        aria-label={`${title}: live stream`}
        className="aspect-video w-full rounded-lg bg-black"
      />
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          The stream could not be played in this browser. Try reloading the
          page.
        </p>
      ) : null}
    </div>
  );
}
