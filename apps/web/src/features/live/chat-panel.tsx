"use client";

import type { ChatMessage } from "@opspilot/contracts";
import { type SyntheticEvent, useState } from "react";

import { PublicButton } from "../public/public-ui";
import type { PendingMessage } from "./use-live";

const MAX_LENGTH = 1_000;

/** Live chat (FR-RN-2), for attendees and staff alike. */
export function ChatPanel({
  messages,
  pending,
  onSend,
  onRetry,
  onDelete,
  disabledReason,
}: Readonly<{
  messages: readonly ChatMessage[];
  pending: readonly PendingMessage[];
  onSend: (body: string) => void;
  onRetry: (clientMessageId: string) => void;
  /** Moderators only (FR-RN-3). */
  onDelete?: (message: ChatMessage) => void;
  /** Why this viewer cannot write now; undefined when they can. */
  disabledReason?: string;
}>) {
  const [draft, setDraft] = useState("");

  function submit(form: SyntheticEvent) {
    form.preventDefault();
    const body = draft.trim();
    if (body !== "") {
      onSend(body);
      setDraft("");
    }
  }

  return (
    <section aria-labelledby="chat-heading" className="grid gap-3">
      <h2 id="chat-heading" className="text-lg font-semibold">
        Chat
      </h2>
      {/* The log announces new messages; the list inside keeps them a list. */}
      <div
        role="log"
        aria-label="Chat messages"
        className="max-h-96 overflow-y-auto rounded-lg border p-3"
      >
        <ol className="grid gap-2">
          {messages.length === 0 && pending.length === 0 ? (
            <li className="text-sm text-muted-foreground">No messages yet.</li>
          ) : null}
          {messages.map((message) => (
            <li key={message.id} className="grid gap-0.5 text-sm">
              <span className="font-medium">
                {message.author.name}
                {message.author.kind === "STAFF" ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (team)
                  </span>
                ) : null}
              </span>
              {message.deleted ? (
                <span className="text-muted-foreground italic">
                  Message removed by a moderator.
                </span>
              ) : (
                <span className="whitespace-pre-wrap">{message.body}</span>
              )}
              {onDelete !== undefined && !message.deleted ? (
                <button
                  type="button"
                  className="justify-self-start text-xs underline"
                  onClick={() => {
                    onDelete(message);
                  }}
                >
                  Delete message from {message.author.name}
                </button>
              ) : null}
            </li>
          ))}
          {pending.map((message) => (
            <li
              key={message.clientMessageId}
              className="grid gap-0.5 text-sm text-muted-foreground"
            >
              <span className="whitespace-pre-wrap">{message.body}</span>
              {message.failed ? (
                <span>
                  Not sent.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      onRetry(message.clientMessageId);
                    }}
                  >
                    Try again
                  </button>
                </span>
              ) : (
                <span>Sending…</span>
              )}
            </li>
          ))}
        </ol>
      </div>
      {disabledReason === undefined ? (
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="chat-message" className="sr-only">
            Your message
          </label>
          <input
            id="chat-message"
            value={draft}
            maxLength={MAX_LENGTH}
            autoComplete="off"
            onChange={(change) => {
              setDraft(change.target.value);
            }}
            className="h-8 w-0 min-w-0 grow rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
          />
          <PublicButton type="submit" disabled={draft.trim() === ""}>
            Send
          </PublicButton>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      )}
    </section>
  );
}
