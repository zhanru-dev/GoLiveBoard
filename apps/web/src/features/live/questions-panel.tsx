"use client";

import type { Question, QuestionStatus } from "@goliveboard/contracts";
import { type SyntheticEvent, useState } from "react";

import { PublicButton } from "../public/public-ui";

const MAX_LENGTH = 1_000;

const STATUS_NOTES: Partial<Record<QuestionStatus, string>> = {
  PENDING: "Waiting for a moderator",
  HIDDEN: "Hidden by a moderator",
  ANSWERED: "Answered",
};

/** Q&A (FR-RN-4): ask, and vote for what should be answered next. */
export function QuestionsPanel({
  questions,
  onAsk,
  onVote,
  disabledReason,
  error,
}: Readonly<{
  questions: readonly Question[];
  /** Resolves true once the question is stored. */
  onAsk?: (body: string) => Promise<boolean>;
  onVote?: (question: Question) => void;
  disabledReason?: string;
  error?: string;
}>) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(form: SyntheticEvent) {
    form.preventDefault();
    const body = draft.trim();
    if (body === "" || onAsk === undefined) {
      return;
    }
    setBusy(true);
    if (await onAsk(body)) {
      setDraft("");
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="questions-heading" className="grid gap-3">
      <h2 id="questions-heading" className="text-lg font-semibold">
        Questions
      </h2>
      {onAsk !== undefined && disabledReason === undefined ? (
        <form
          method="post"
          onSubmit={(form) => void submit(form)}
          className="flex gap-2"
        >
          <label htmlFor="question-body" className="sr-only">
            Your question
          </label>
          <input
            id="question-body"
            value={draft}
            maxLength={MAX_LENGTH}
            autoComplete="off"
            placeholder="Ask a question"
            onChange={(change) => {
              setDraft(change.target.value);
            }}
            className="h-8 min-w-0 grow rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
          />
          <PublicButton type="submit" disabled={busy || draft.trim() === ""}>
            Ask
          </PublicButton>
        </form>
      ) : null}
      {disabledReason === undefined ? null : (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      )}
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ol aria-label="Questions" className="grid gap-2">
        {questions.length === 0 ? (
          <li className="text-sm text-muted-foreground">No questions yet.</li>
        ) : null}
        {questions.map((question) => (
          <li
            key={question.id}
            className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm"
          >
            <div className="grid gap-1">
              <p className="whitespace-pre-wrap">{question.body}</p>
              <p className="text-xs text-muted-foreground">
                {question.author.name}
                {question.pinSlot === null ? "" : " · Pinned"}
                {STATUS_NOTES[question.status] === undefined
                  ? ""
                  : ` · ${STATUS_NOTES[question.status] ?? ""}`}
                {question.mine === true ? " · Yours" : ""}
                {question.mergedIntoId === null
                  ? ""
                  : " · Merged with a similar question"}
              </p>
            </div>
            {onVote !== undefined &&
            question.status === "PUBLISHED" &&
            question.mergedIntoId === null ? (
              <PublicButton
                variant={question.votedByMe === true ? "default" : "outline"}
                size="sm"
                aria-pressed={question.votedByMe === true}
                aria-label={`Vote for: ${question.body}`}
                onClick={() => {
                  onVote(question);
                }}
              >
                ▲ {question.voteCount}
              </PublicButton>
            ) : (
              <span className="text-xs text-muted-foreground">
                {question.voteCount}{" "}
                {question.voteCount === 1 ? "vote" : "votes"}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
