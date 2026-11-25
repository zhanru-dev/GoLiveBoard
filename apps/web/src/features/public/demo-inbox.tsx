"use client";

import { DemoInbox as DemoInboxBody } from "@opspilot/contracts";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import { api } from "@/lib/api";
import { formatInZone } from "@/lib/time";

/**
 * The demo inbox (FR-AUTH-5): the mail for the attendees this browser
 * registered in the demo, which is never really sent.
 */
export function DemoInbox() {
  const inbox = useQuery({
    queryKey: ["demo-inbox"],
    queryFn: ({ signal }) =>
      api("/public/demo-inbox", { schema: DemoInboxBody, signal }),
    refetchInterval: 5_000,
  });

  if (inbox.isPending) {
    return <p role="status">Loading…</p>;
  }
  if (inbox.isError) {
    return <p role="alert">Could not load the inbox.</p>;
  }
  if (inbox.data.messages.length === 0) {
    return (
      <p>
        Nothing yet. Register for an event of the demo, and its emails appear
        here.
      </p>
    );
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <ol className="grid gap-4" aria-label="Messages">
      {inbox.data.messages.map((message) => (
        <li key={message.id} className="rounded-lg border p-4">
          <article aria-label={message.subject} className="grid gap-2">
            <h2 className="font-semibold">{message.subject}</h2>
            <p className="text-sm text-muted-foreground">
              {formatInZone(message.receivedAt, zone)}
            </p>
            <p className="whitespace-pre-wrap break-words">
              <MessageText text={message.text} />
            </p>
          </article>
        </li>
      ))}
    </ol>
  );
}

/**
 * The message, with links to this site made clickable. Other text stays
 * text: the messages are ours, but nothing is rendered as HTML.
 */
function MessageText({ text }: Readonly<{ text: string }>) {
  const origin = window.location.origin;
  const parts = text.split(/(https?:\/\/\S+)/);
  return parts.map((part, index) =>
    part.startsWith(`${origin}/`) ? (
      <a key={index} className="underline" href={part}>
        {part}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
