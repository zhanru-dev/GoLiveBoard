import type { Question } from "@goliveboard/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderScreen } from "@/testing/render";

import { AnswerForm, canAnswerInWriting } from "./answer-form";

const question = (changes: Partial<Question> = {}): Question => ({
  id: "0195f0a0-0000-7000-8000-0000000000a1",
  body: "When does it ship?",
  status: "PUBLISHED",
  author: { kind: "ATTENDEE", name: "Ada" },
  pinSlot: null,
  voteCount: 0,
  answer: null,
  mergedIntoId: null,
  version: 1,
  createdAt: "2026-11-15T12:00:00.000Z",
  ...changes,
});

const ANSWERED = question({
  status: "ANSWERED",
  answer: { body: "Next week.", answeredAt: "2026-11-15T12:05:00.000Z" },
});

describe("AnswerForm (FR-RN-5)", () => {
  it("publishes the trimmed answer, and not an empty one", async () => {
    const onSave = vi.fn();
    renderScreen(
      <AnswerForm
        question={question()}
        pending={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const publish = screen.getByRole("button", { name: "Publish answer" });

    expect(publish).toBeDisabled();
    await user.type(screen.getByLabelText("Your answer"), "   ");
    expect(publish).toBeDisabled();
    await user.type(screen.getByLabelText("Your answer"), "Next week. ");
    await user.click(publish);

    expect(onSave).toHaveBeenCalledWith("Next week.");
    expect(screen.queryByRole("button", { name: "Remove answer" })).toBeNull();
  });

  it("edits or removes an existing answer", async () => {
    const onSave = vi.fn();
    renderScreen(
      <AnswerForm
        question={ANSWERED}
        pending={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    expect(screen.getByLabelText("Your answer")).toHaveValue("Next week.");
    await user.click(screen.getByRole("button", { name: "Remove answer" }));
    expect(onSave).toHaveBeenLastCalledWith(null);
    await user.clear(screen.getByLabelText("Your answer"));
    await user.type(screen.getByLabelText("Your answer"), "Tomorrow.");
    await user.click(screen.getByRole("button", { name: "Save answer" }));
    expect(onSave).toHaveBeenLastCalledWith("Tomorrow.");
  });
});

describe("canAnswerInWriting", () => {
  it("allows published and answered questions that were not merged", () => {
    expect(canAnswerInWriting(question())).toBe(true);
    expect(canAnswerInWriting(ANSWERED)).toBe(true);
    expect(canAnswerInWriting(question({ status: "PENDING" }))).toBe(false);
    expect(canAnswerInWriting(question({ status: "HIDDEN" }))).toBe(false);
    expect(canAnswerInWriting(question({ mergedIntoId: ANSWERED.id }))).toBe(
      false,
    );
  });
});
