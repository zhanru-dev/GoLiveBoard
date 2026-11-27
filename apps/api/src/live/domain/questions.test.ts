import type { QuestionStatus } from "@goliveboard/contracts";
import { describe, expect, it } from "vitest";

import {
  initialQuestionStatus,
  isQuestionVisibleTo,
  isVotable,
  planModeration,
} from "./questions.js";

const STATUSES: QuestionStatus[] = [
  "PENDING",
  "PUBLISHED",
  "HIDDEN",
  "ANSWERED",
];

describe("initialQuestionStatus (FR-RN-4)", () => {
  it("publishes at once unless pre-moderation holds an attendee's question", () => {
    expect(initialQuestionStatus(false, false)).toBe("PUBLISHED");
    expect(initialQuestionStatus(true, false)).toBe("PENDING");
    expect(initialQuestionStatus(true, true)).toBe("PUBLISHED");
  });
});

describe("isQuestionVisibleTo", () => {
  const by = (status: QuestionStatus, mergedIntoId: string | null = null) => ({
    status,
    mergedIntoId,
    authorAttendeeId: "author",
    authorUserId: null,
  });

  it("shows published and answered questions to everyone", () => {
    for (const status of ["PUBLISHED", "ANSWERED"] as const) {
      expect(isQuestionVisibleTo(by(status), { moderator: false })).toBe(true);
    }
  });

  it("shows pending and hidden ones only to their author and moderators", () => {
    for (const status of ["PENDING", "HIDDEN"] as const) {
      expect(
        isQuestionVisibleTo(by(status), {
          attendeeId: "other",
          moderator: false,
        }),
      ).toBe(false);
      expect(
        isQuestionVisibleTo(by(status), {
          attendeeId: "author",
          moderator: false,
        }),
      ).toBe(true);
      expect(isQuestionVisibleTo(by(status), { moderator: true })).toBe(true);
    }
  });

  it("shows a merged question only to its author and moderators, even if published", () => {
    for (const status of ["PUBLISHED", "ANSWERED"] as const) {
      const merged = by(status, "another");
      expect(
        isQuestionVisibleTo(merged, { attendeeId: "other", moderator: false }),
      ).toBe(false);
      expect(
        isQuestionVisibleTo(merged, { attendeeId: "author", moderator: false }),
      ).toBe(true);
      expect(isQuestionVisibleTo(merged, { moderator: true })).toBe(true);
    }
  });

  it("recognises a staff author by user", () => {
    const question = {
      status: "PENDING" as const,
      mergedIntoId: null,
      authorAttendeeId: null,
      authorUserId: "ada",
    };
    expect(
      isQuestionVisibleTo(question, { userId: "ada", moderator: false }),
    ).toBe(true);
    expect(
      isQuestionVisibleTo(question, { userId: "bob", moderator: false }),
    ).toBe(false);
  });
});

describe("isVotable", () => {
  it("takes votes on published questions only", () => {
    expect(
      STATUSES.filter((status) => isVotable({ status, mergedIntoId: null })),
    ).toEqual(["PUBLISHED"]);
    expect(isVotable({ status: "PUBLISHED", mergedIntoId: "another" })).toBe(
      false,
    );
  });
});

describe("planModeration (FR-RN-5)", () => {
  it("never pins a question merged into another", () => {
    expect(
      planModeration(
        { status: "PUBLISHED", pinSlot: null, mergedIntoId: "another" },
        { pinned: true },
        [],
      ),
    ).toEqual({ allowed: false, reason: "NOT_PINNABLE" });
  });

  const at = (status: QuestionStatus, pinSlot: number | null = null) => ({
    status,
    pinSlot,
  });

  it("allows exactly the listed status moves", () => {
    const allowed = STATUSES.flatMap((from) =>
      STATUSES.filter((to) => to !== from)
        .filter((to) => planModeration(at(from), { status: to }, []).allowed)
        .map((to) => `${from}->${to}`),
    );
    expect(allowed).toEqual([
      "PENDING->PUBLISHED",
      "PENDING->HIDDEN",
      "PUBLISHED->HIDDEN",
      "PUBLISHED->ANSWERED",
      "HIDDEN->PUBLISHED",
      "ANSWERED->PUBLISHED",
    ]);
    expect(planModeration(at("HIDDEN"), { status: "ANSWERED" }, [])).toEqual({
      allowed: false,
      reason: "ILLEGAL_TRANSITION",
    });
  });

  it("treats the current status as no change", () => {
    expect(
      planModeration(at("PUBLISHED", 2), { status: "PUBLISHED" }, [2]),
    ).toEqual({ allowed: true, status: "PUBLISHED", pinSlot: 2, answer: null });
  });

  it("pins into the lowest free slot, and refuses a fourth", () => {
    expect(planModeration(at("PUBLISHED"), { pinned: true }, [1, 3])).toEqual({
      allowed: true,
      status: "PUBLISHED",
      pinSlot: 2,
      answer: null,
    });
    expect(planModeration(at("ANSWERED"), { pinned: true }, [])).toMatchObject({
      pinSlot: 1,
    });
    expect(
      planModeration(at("PUBLISHED"), { pinned: true }, [1, 2, 3]),
    ).toEqual({
      allowed: false,
      reason: "PIN_LIMIT_REACHED",
    });
  });

  it("keeps a pinned question's slot, and unpins on request", () => {
    expect(
      planModeration(at("PUBLISHED", 3), { status: "ANSWERED" }, [1, 2]),
    ).toEqual({ allowed: true, status: "ANSWERED", pinSlot: 3, answer: null });
    expect(planModeration(at("PUBLISHED", 3), { pinned: false }, [])).toEqual({
      allowed: true,
      status: "PUBLISHED",
      pinSlot: null,
      answer: null,
    });
  });

  it("unpins a question that is hidden, and refuses to pin a pending or hidden one", () => {
    expect(
      planModeration(at("PUBLISHED", 1), { status: "HIDDEN" }, []),
    ).toEqual({
      allowed: true,
      status: "HIDDEN",
      pinSlot: null,
      answer: null,
    });
    for (const status of ["PENDING", "HIDDEN"] as const) {
      expect(planModeration(at(status), { pinned: true }, [])).toEqual({
        allowed: false,
        reason: "NOT_PINNABLE",
      });
    }
    expect(
      planModeration(
        at("PUBLISHED", 1),
        { status: "HIDDEN", pinned: true },
        [],
      ),
    ).toEqual({ allowed: false, reason: "NOT_PINNABLE" });
  });
});

describe("planModeration: written answers (FR-RN-5)", () => {
  const at = (
    status: QuestionStatus,
    answer: string | null = null,
    mergedIntoId: string | null = null,
  ) => ({ status, pinSlot: null, answer, mergedIntoId });
  const refused = { allowed: false, reason: "ILLEGAL_TRANSITION" };

  it("answers a published question when an answer is written", () => {
    expect(
      planModeration(at("PUBLISHED"), { answer: "Next week." }, []),
    ).toEqual({
      allowed: true,
      status: "ANSWERED",
      pinSlot: null,
      answer: "Next week.",
    });
  });

  it("replaces or removes the answer of an answered question, which stays answered", () => {
    const answered = at("ANSWERED", "Next week.");
    expect(planModeration(answered, { answer: "Tomorrow." }, [])).toMatchObject(
      {
        status: "ANSWERED",
        answer: "Tomorrow.",
      },
    );
    expect(planModeration(answered, { answer: null }, [])).toMatchObject({
      status: "ANSWERED",
      answer: null,
    });
    expect(planModeration(answered, { pinned: true }, [])).toMatchObject({
      answer: "Next week.",
    });
  });

  it("removes the answer when the question is reopened", () => {
    expect(
      planModeration(at("ANSWERED", "Next week."), { status: "PUBLISHED" }, []),
    ).toEqual({
      allowed: true,
      status: "PUBLISHED",
      pinSlot: null,
      answer: null,
    });
  });

  it("refuses an answer to a pending, hidden or merged question", () => {
    expect(planModeration(at("PENDING"), { answer: "Yes." }, [])).toEqual(
      refused,
    );
    expect(planModeration(at("HIDDEN"), { answer: "Yes." }, [])).toEqual(
      refused,
    );
    expect(
      planModeration(at("PUBLISHED", null, "another"), { answer: "Yes." }, []),
    ).toEqual(refused);
    expect(
      planModeration(at("PUBLISHED"), { status: "HIDDEN", answer: "Yes." }, []),
    ).toEqual(refused);
  });

  it("marks a question answered without an answer, as before", () => {
    expect(planModeration(at("PUBLISHED"), { status: "ANSWERED" }, [])).toEqual(
      {
        allowed: true,
        status: "ANSWERED",
        pinSlot: null,
        answer: null,
      },
    );
  });
});
