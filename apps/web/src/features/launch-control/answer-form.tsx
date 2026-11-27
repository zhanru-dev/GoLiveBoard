"use client";

import { AnswerBody, type Question } from "@goliveboard/contracts";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_LENGTH = 2000;

/**
 * A moderator's written answer to a question (FR-RN-5): publishing one on a
 * published question also marks it answered.
 */
export function AnswerForm({
  question,
  pending,
  onSave,
  onCancel,
}: Readonly<{
  question: Question;
  pending: boolean;
  /** The trimmed answer, or null to remove the current one. */
  onSave: (answer: string | null) => void;
  onCancel: () => void;
}>) {
  const [draft, setDraft] = useState(question.answer?.body ?? "");
  const fieldId = useId();
  const valid = AnswerBody.safeParse(draft).success;
  return (
    <form
      method="post"
      className="grid gap-2"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        if (valid) {
          onSave(draft.trim());
        }
      }}
    >
      <label htmlFor={fieldId} className="font-medium">
        Your answer
      </label>
      <Textarea
        id={fieldId}
        value={draft}
        maxLength={MAX_LENGTH}
        rows={3}
        onChange={(change) => {
          setDraft(change.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || !valid}>
          {question.answer === null ? "Publish answer" : "Save answer"}
        </Button>
        {question.answer === null ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              onSave(null);
            }}
          >
            Remove answer
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Whether a moderator may answer a question in writing now. */
export function canAnswerInWriting(question: Question): boolean {
  return (
    question.mergedIntoId === null &&
    (question.status === "PUBLISHED" || question.status === "ANSWERED")
  );
}
