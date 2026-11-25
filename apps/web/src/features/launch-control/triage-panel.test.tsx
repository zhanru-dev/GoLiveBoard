import type { Question, TriageRun } from "@opspilot/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { problem } from "@/testing/events";
import { OWNER, renderScreen } from "@/testing/render";
import { server } from "@/testing/server";

import { TriagePanel } from "./triage-panel";

const EVENT_ID = "0195f0a0-0000-7000-8000-0000000000e0";
const RUN_ID = "0195f0a0-0000-7000-8000-0000000000f0";
const id = (n: number) => `0195f0a0-0000-7000-8000-00000000000${String(n)}`;

const question = (n: number, body: string): Question => ({
  id: id(n),
  body,
  status: "PUBLISHED",
  author: { kind: "ATTENDEE", name: "Ada" },
  pinSlot: null,
  voteCount: 0,
  mergedIntoId: null,
  version: 1,
  createdAt: "2026-11-17T10:00:00.000Z",
});

const QUESTIONS = [
  question(1, "How much does it cost?"),
  question(2, "What is the price?"),
  question(3, "Is it recorded?"),
  question(4, "Will there be a replay?"),
];

const run = (changes: Partial<TriageRun> = {}): TriageRun => ({
  id: RUN_ID,
  eventId: EVENT_ID,
  status: "SUCCEEDED",
  decision: "PENDING",
  questionCount: 4,
  suggestions: {
    groups: [
      {
        representativeId: id(1),
        questionIds: [id(1), id(2)],
        reason: "Both ask the price",
      },
      {
        representativeId: id(3),
        questionIds: [id(3), id(4)],
        reason: "Both ask about a recording",
      },
    ],
    answerOrder: [id(1), id(3)],
  },
  failure: null,
  model: "claude-opus-5-5",
  latencyMs: 2_000,
  inputTokens: 900,
  outputTokens: 120,
  costMicros: 6_000,
  mergedCount: null,
  createdAt: "2026-11-17T10:00:00.000Z",
  finishedAt: "2026-11-17T10:00:02.000Z",
  ...changes,
});

function serve(runs: TriageRun[], latest: TriageRun | null = null) {
  let read = 0;
  server.use(
    http.get(`*/api/v1/events/${EVENT_ID}/question-triage-runs/latest`, () =>
      latest === null
        ? HttpResponse.json(problem(404, "NOT_FOUND"), { status: 404 })
        : HttpResponse.json(latest),
    ),
    http.post(`*/api/v1/events/${EVENT_ID}/question-triage-runs`, () =>
      HttpResponse.json({ id: RUN_ID }, { status: 202 }),
    ),
    http.get(`*/api/v1/question-triage-runs/${RUN_ID}`, () => {
      const answer = runs[Math.min(read, runs.length - 1)];
      read += 1;
      return HttpResponse.json(answer);
    }),
  );
}

const show = () =>
  renderScreen(
    <TriagePanel
      eventId={EVENT_ID}
      workspaceId={OWNER.activeWorkspace.workspaceId}
      questions={QUESTIONS}
    />,
    OWNER,
  );

describe("TriagePanel", () => {
  it("asks for suggestions, waits while the run is under way, and shows the groups and order", async () => {
    serve([
      run({ status: "RUNNING", suggestions: null, finishedAt: null }),
      run(),
    ]);
    show();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Suggest groups" }));

    expect(await screen.findByText("Sorting questions…")).toBeInTheDocument();
    const groups = await screen.findByRole(
      "group",
      {
        name: /Choose the groups to merge/,
      },
      { timeout: 3_000 },
    );
    expect(within(groups).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(groups).getByText("What is the price?")).toBeInTheDocument();
    expect(within(groups).getByText("Both ask the price")).toBeInTheDocument();
    const order = screen.getByText(
      "Suggested order to answer",
    ).nextElementSibling;
    expect(order?.textContent).toBe("How much does it cost?Is it recorded?");
    expect(
      screen.getByRole("button", { name: "Merge selected" }),
    ).toBeDisabled();
  });

  it("merges only the groups the moderator chose", async () => {
    serve([run()]);
    let sent: unknown;
    server.use(
      http.post(
        `*/api/v1/question-triage-runs/${RUN_ID}/decision`,
        async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(
            run({ decision: "PARTIAL", mergedCount: 1 }),
          );
        },
      ),
    );
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Suggest groups" }));

    await user.click(
      await screen.findByRole("checkbox", { name: /Is it recorded\?/ }),
    );
    await user.click(screen.getByRole("button", { name: "Merge selected" }));

    await expect.poll(() => sent).toEqual({ acceptedGroups: [1] });
    expect(await screen.findByText("Merged 1 question")).toBeInTheDocument();
  });

  it("dismisses the suggestions, which changes nothing", async () => {
    serve([run()]);
    let sent: unknown;
    server.use(
      http.post(
        `*/api/v1/question-triage-runs/${RUN_ID}/decision`,
        async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(
            run({ decision: "REJECTED", mergedCount: 0 }),
          );
        },
      ),
    );
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Suggest groups" }));

    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    await expect.poll(() => sent).toEqual({ acceptedGroups: [] });
    expect(
      await screen.findByText("Suggestions dismissed"),
    ).toBeInTheDocument();
  });

  it.each([
    ["TIMED_OUT", "The AI model did not answer within 8 seconds"],
    ["FAILED", "The AI provider answered 529"],
  ] as const)(
    "says suggestions are unavailable when the run %s, and that Q&A carries on",
    async (status, failure) => {
      serve([run({ status, suggestions: null, failure })]);
      show();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Suggest groups" }));

      expect(
        await screen.findByText("Suggestions are unavailable"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(`${failure} Q&A works as usual.`),
      ).toBeInTheDocument();
    },
  );

  it.each([
    [
      "TRIAGE_UNAVAILABLE",
      503,
      "AI suggestions are not set up on this server.",
    ],
    ["TRIAGE_BUDGET_SPENT", 429, "Today's budget for AI suggestions is spent."],
    ["TRIAGE_NOTHING_TO_SORT", 409, "There are no open questions to sort."],
  ])("explains a refusal (%s)", async (code, status, text) => {
    server.use(
      http.post(`*/api/v1/events/${EVENT_ID}/question-triage-runs`, () =>
        HttpResponse.json(problem(status, code), { status }),
      ),
    );
    show();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Suggest groups" }));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("comes back to a run waiting for a decision", async () => {
    serve([run()], run());
    show();

    expect(
      await screen.findByRole("group", { name: /Choose the groups to merge/ }),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "waits for approval",
      [
        {
          ...question(1, "How much does it cost?"),
          status: "PENDING" as const,
        },
        ...QUESTIONS.slice(1),
      ],
      "Its first question waits for approval: publish it to merge into it.",
    ],
    [
      "is hidden",
      [
        { ...question(1, "How much does it cost?"), status: "HIDDEN" as const },
        ...QUESTIONS.slice(1),
      ],
      "Its first question is hidden.",
    ],
    [
      "was merged into another",
      [
        { ...question(1, "How much does it cost?"), mergedIntoId: id(3) },
        ...QUESTIONS.slice(1),
      ],
      "Its first question was merged into another.",
    ],
    ["is gone", QUESTIONS.slice(1), "Its first question is no longer there."],
  ])(
    "will not merge into a first question that %s, and says why",
    async (_state, questions, reason) => {
      serve([run()]);
      renderScreen(
        <TriagePanel
          eventId={EVENT_ID}
          workspaceId={OWNER.activeWorkspace.workspaceId}
          questions={questions}
        />,
        OWNER,
      );

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Suggest groups" }));

      const groups = await screen.findByRole("group", {
        name: /Choose the groups to merge/,
      });
      const [first, second] = within(groups).getAllByRole("checkbox");
      expect(first).toBeDisabled();
      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(second).toBeEnabled();
    },
  );

  it("stops asking when the run cannot be read, and lets the moderator try again", async () => {
    let reads = 0;
    server.use(
      http.get(`*/api/v1/events/${EVENT_ID}/question-triage-runs/latest`, () =>
        HttpResponse.json(problem(404, "NOT_FOUND"), { status: 404 }),
      ),
      http.post(`*/api/v1/events/${EVENT_ID}/question-triage-runs`, () =>
        HttpResponse.json({ id: RUN_ID }, { status: 202 }),
      ),
      http.get(`*/api/v1/question-triage-runs/${RUN_ID}`, () => {
        reads += 1;
        return HttpResponse.json(problem(500, "INTERNAL_ERROR"), {
          status: 500,
        });
      }),
    );
    show();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Suggest groups" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The suggestions could not be read",
    );
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(reads).toBe(1);
    expect(
      screen.getByRole("button", { name: "Suggest groups" }),
    ).toBeEnabled();
  });

  it("says when nothing asks the same thing", async () => {
    serve([run({ suggestions: { groups: [], answerOrder: [id(3)] } })]);
    show();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Suggest groups" }));

    expect(
      await screen.findByText("No questions ask the same thing."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge selected" })).toBeNull();
  });
});
