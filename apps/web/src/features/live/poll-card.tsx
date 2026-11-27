"use client";

import type { Poll } from "@goliveboard/contracts";
import { useId, useRef, useState } from "react";

import { PublicButton } from "../public/public-ui";
import { PollResults } from "./poll-results";

/** The poll an attendee sees: the open one, otherwise the latest closed. */
export function currentPoll(polls: readonly Poll[]): Poll | undefined {
  return (
    polls.find(({ status }) => status === "OPEN") ??
    polls.find(({ status }) => status === "CLOSED")
  );
}

/**
 * A live poll on the watch page (FR-RN-8): one answer, then the counts.
 * Counts appear only once the attendee has answered, or the poll has
 * closed, so they do not sway the answer.
 */
export function PollCard({
  polls,
  onAnswer,
  error,
}: Readonly<{
  polls: readonly Poll[];
  /** Resolves whether the answer was taken. */
  onAnswer: (poll: Poll, optionId: string) => Promise<boolean>;
  error?: string;
}>) {
  const poll = currentPoll(polls);
  const [choice, setChoice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const name = useId();
  if (poll === undefined) {
    return null;
  }
  const answering =
    poll.status === "OPEN" &&
    (poll.myOptionId === null || poll.myOptionId === undefined);
  return (
    <section
      aria-labelledby={`${name}-heading`}
      className="grid gap-3 rounded-lg border p-4"
    >
      {/* The form goes once answered: keep the place and say so. */}
      <p role="status" className="sr-only">
        {sent ? "Answer sent. The results are below." : ""}
      </p>
      <h2
        id={`${name}-heading`}
        ref={heading}
        tabIndex={-1}
        className="text-sm font-semibold"
      >
        {poll.status === "OPEN" ? "Live poll" : "Poll results"}
      </h2>
      {answering ? (
        <form
          method="post"
          className="grid gap-3"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            if (choice === undefined) return;
            setBusy(true);
            void onAnswer(poll, choice)
              .then((taken) => {
                if (taken) {
                  setSent(true);
                  heading.current?.focus();
                }
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-2 font-medium">{poll.question}</legend>
            {poll.options.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name={name}
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => {
                    setChoice(option.id);
                  }}
                  className="size-4"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <PublicButton
            type="submit"
            className="justify-self-start"
            disabled={busy || choice === undefined}
          >
            Send answer
          </PublicButton>
        </form>
      ) : (
        <>
          <p className="font-medium">{poll.question}</p>
          <PollResults poll={poll} />
        </>
      )}
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
