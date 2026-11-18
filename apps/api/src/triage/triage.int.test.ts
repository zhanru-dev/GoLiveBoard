import type { INestApplicationContext } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  AuditPage,
  ChannelJoined,
  ProblemDetails,
  Question,
  QuestionList,
  type QuestionsEvent,
  TriageRun,
  TriageRunStarted,
} from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { openEvent, PublicClient, registration } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import {
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { cookieHeader } from "../testing/cookies.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import { createTestApp, createTestWorker } from "../testing/test-app.js";
import { TriageConsumer } from "../worker/triage.consumer.js";
import type { ModelTriage } from "./domain/prompt.js";
import {
  type TriageAnswer,
  TriageModel,
  TriageModelError,
} from "./triage-model.js";
import { TriageRunner } from "./triage-runner.js";

let addressCounter = 0;
const newAddress = () => `198.18.11.${String((addressCounter += 1) % 250)}`;

/** A model whose answer each test sets; it records what it was sent. */
class ScriptedModel extends TriageModel {
  readonly sent: string[] = [];
  answer: (questions: string, signal: AbortSignal) => Promise<TriageAnswer> =
    () => Promise.reject(new Error("No answer set"));

  triage(questions: string, signal: AbortSignal): Promise<TriageAnswer> {
    this.sent.push(questions);
    return this.answer(questions, signal);
  }
}

/** A value the test set up, or a failure saying it is missing. */
function need<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Missing test data");
  }
  return value;
}

/** The label the prompt gave a question, found by its text. */
function labelOf(prompt: string, text: string): string {
  const line = prompt
    .split("\n")
    .find((candidate) => candidate.endsWith(`: ${text}`));
  const label = line?.split(":")[0];
  if (label === undefined) {
    throw new Error(`"${text}" was not sent`);
  }
  return label;
}

const answered = (
  output: ModelTriage,
  model = "claude-opus-5-5",
): TriageAnswer => ({
  output,
  model,
  usage: { inputTokens: 1_000, outputTokens: 100 },
  attempts: [{ model, inputTokens: 1_000, outputTokens: 100 }],
});

describe("AI question triage (FR-RN-6, ADR-0012)", { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let url: string;
  const clients: RealtimeClient[] = [];
  const mailer = new CapturingMailer();
  const model = new ScriptedModel();

  beforeAll(async () => {
    database = await createTestDatabase();
    const env = {
      DATABASE_URL: database.url,
      VALKEY_URL: inject("valkeyUrl"),
      TRUST_PROXY_HOPS: "1",
    };
    app = await createTestApp({ env, mailer, triageModel: model });
    url = await listen(app);
    worker = await createTestWorker({ env, triageModel: model });
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    await worker.close();
    await app.close();
    await database.drop();
  });

  const api = () => new ApiClient(app, newAddress());

  async function attendee(slug: string) {
    const email = uniqueEmail("att");
    const browser = new PublicClient(app, newAddress());
    await browser.register(slug, registration(email));
    const verified = await browser.verify(
      tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
    );
    if (verified.attendee?.cookie(ATTENDEE_COOKIE) === undefined) {
      throw new Error(`Verification failed: ${verified.response.text}`);
    }
    return verified.attendee;
  }
  type Browser = Awaited<ReturnType<typeof attendee>>;

  async function asked(browser: Browser, slug: string, body: string) {
    const response = await browser.post(`/public/events/${slug}/questions`, {
      body,
    });
    expect(response.status, response.text).toBe(201);
    return Question.parse(response.body);
  }

  const vote = (browser: Browser, slug: string, id: string) =>
    browser.put(`/public/events/${slug}/questions/${id}/vote`);

  /** An event with an attendee and these questions, asked by them. */
  async function withQuestions(texts: readonly string[]) {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner);
    const asker = await attendee(event.slug);
    const questions: Question[] = [];
    for (const text of texts) {
      questions.push(await asked(asker, event.slug, text));
    }
    return { client, owner, event, asker, questions };
  }

  async function started(
    client: ApiClient,
    owner: TestSession,
    eventId: string,
  ) {
    const response = await client.send(
      owner,
      "post",
      `/events/${eventId}/question-triage-runs`,
    );
    expect(response.status, response.text).toBe(202);
    return TriageRunStarted.parse(response.body).id;
  }

  async function runOf(client: ApiClient, owner: TestSession, runId: string) {
    const response = await client.get(owner, `/question-triage-runs/${runId}`);
    expect(response.status, response.text).toBe(200);
    return TriageRun.parse(response.body);
  }

  const decide = (
    client: ApiClient,
    owner: TestSession,
    runId: string,
    acceptedGroups: number[],
  ) =>
    client.send(owner, "post", `/question-triage-runs/${runId}/decision`, {
      acceptedGroups,
    });

  /** Asks for a run, and carries it out as the worker would. */
  async function triaged(
    client: ApiClient,
    owner: TestSession,
    eventId: string,
  ) {
    const runId = await started(client, owner, eventId);
    await worker.get(TriageRunner).run(runId);
    return runOf(client, owner, runId);
  }

  const pricing = [
    "How much does it cost?",
    "What is the price?",
    "Is there a free tier?",
  ];

  it("suggests groups, and merges an accepted one in one go: votes, lists and the record", async () => {
    const { client, owner, event, asker, questions } =
      await withQuestions(pricing);
    const [howMuch, price, free] = questions;
    // Two attendees: one voted for both duplicates, one for the second only.
    const other = await attendee(event.slug);
    await vote(asker, event.slug, howMuch?.id ?? "");
    await vote(asker, event.slug, price?.id ?? "");
    await vote(other, event.slug, price?.id ?? "");
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      const c = labelOf(prompt, "Is there a free tier?");
      return Promise.resolve(
        answered({
          groups: [
            {
              representative: a,
              questions: [a, b],
              reason: "Both ask the price",
            },
          ],
          answer_order: [a, c],
        }),
      );
    };

    const run = await triaged(client, owner, event.id);

    expect(run).toMatchObject({
      status: "SUCCEEDED",
      decision: "PENDING",
      questionCount: 3,
      suggestions: {
        groups: [
          {
            representativeId: howMuch?.id,
            questionIds: [howMuch?.id, price?.id],
            reason: "Both ask the price",
          },
        ],
        answerOrder: [howMuch?.id, free?.id],
      },
    });
    // Nothing changed yet.
    expect(
      await database.query(
        "SELECT 1 FROM questions WHERE merged_into_id IS NOT NULL AND event_id = $1",
        [event.id],
      ),
    ).toEqual([]);

    const decided = await decide(client, owner, run.id, [0]);

    expect(decided.status, decided.text).toBe(200);
    expect(TriageRun.parse(decided.body).decision).toBe("ACCEPTED");
    const [merged] = await database.query<{
      merged_into_id: string;
      vote_count: number;
    }>("SELECT merged_into_id, vote_count FROM questions WHERE id = $1", [
      price?.id,
    ]);
    expect(merged).toEqual({ merged_into_id: howMuch?.id, vote_count: 0 });
    const [kept] = await database.query<{ vote_count: number }>(
      "SELECT vote_count FROM questions WHERE id = $1",
      [howMuch?.id],
    );
    // Each attendee counted once.
    expect(kept?.vote_count).toBe(2);
    // An attendee who did not ask it no longer sees the merged question...
    const theirs = QuestionList.parse(
      (await other.get(`/public/events/${event.slug}/questions`)).body,
    );
    expect(theirs.items.map(({ id }) => id).sort()).toEqual(
      [howMuch?.id, free?.id].sort(),
    );
    // ...its author and moderators do, marked as merged.
    const mine = QuestionList.parse(
      (await asker.get(`/public/events/${event.slug}/questions`)).body,
    );
    expect(mine.items.find(({ id }) => id === price?.id)?.mergedIntoId).toBe(
      howMuch?.id,
    );
    const moderators = QuestionList.parse(
      (await client.get(owner, `/events/${event.id}/questions`)).body,
    );
    expect(
      moderators.items.find(({ id }) => id === price?.id)?.mergedIntoId,
    ).toBe(howMuch?.id);
    // Nobody votes for a merged question.
    expect((await vote(other, event.slug, price?.id ?? "")).status).toBe(404);
    // Audited.
    const [entry] = AuditPage.parse(
      (
        await client.get(
          owner,
          `/audit-entries?eventId=${event.id}&action=question_triage.decided`,
        )
      ).body,
    ).items;
    expect(entry?.after).toEqual({
      decision: "ACCEPTED",
      acceptedGroups: [0],
      merged: [{ questionId: price?.id, into: howMuch?.id }],
    });
    // On the real-time journal: the merged question, then the new count.
    const journal = await database.query<{ kind: string; entity_id: string }>(
      `SELECT kind, entity_id FROM realtime_journal
       WHERE event_id = $1 AND channel = 'QUESTIONS' ORDER BY sequence DESC LIMIT 2`,
      [event.id],
    );
    expect(journal.reverse()).toEqual([
      { kind: "UPDATED", entity_id: price?.id },
      { kind: "VOTED", entity_id: howMuch?.id },
    ]);
  });

  it("tells everyone on the Q&A: the merged question leaves, the kept one counts its votes", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [howMuch, price] = questions;
    // An attendee who did not ask, listening.
    const listener = await attendee(event.slug);
    await vote(listener, event.slug, price?.id ?? "");
    const live = await RealtimeClient.connect(url, {
      cookie: cookieHeader({
        [ATTENDEE_COOKIE]: listener.cookie(ATTENDEE_COOKIE) ?? "",
      }),
      ip: newAddress(),
    });
    clients.push(live);
    const received: QuestionsEvent[] = [];
    live.onQuestions((change) => received.push(change));
    ChannelJoined.parse(await live.join(event.slug, 0, "QUESTIONS"));
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b], reason: "" }],
          answer_order: [],
        }),
      );
    };
    const run = await triaged(client, owner, event.id);

    await decide(client, owner, run.id, [0]);

    await expect
      .poll(() => received.length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2);
    const [gone, counted] = received.slice(-2);
    expect(gone).toMatchObject({ kind: "WITHDRAWN", questionId: price?.id });
    expect(counted).toMatchObject({
      kind: "VOTED",
      question: { id: howMuch?.id, voteCount: 1, mergedIntoId: null },
    });
    expect((counted?.sequence ?? 0) - (gone?.sequence ?? 0)).toBe(1);
  });

  it("sends the model only labels and the questions' text", async () => {
    const { client, owner, event, questions } = await withQuestions([
      "Will there be a recording?",
      "Who are the speakers?",
    ]);
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));

    await triaged(client, owner, event.id);

    const prompt = model.sent.at(-1) ?? "";
    expect(prompt).toContain(": Will there be a recording?");
    for (const question of questions) {
      expect(prompt).not.toContain(question.id);
    }
    // The asker's name and address are not in it.
    expect(prompt).not.toContain("Ada Lovelace");
    expect(prompt).not.toMatch(/@/);
  });

  it("records the model, latency, tokens and cost of each run", async () => {
    const { client, owner, event } = await withQuestions([
      "What time does it start?",
    ]);
    model.answer = () =>
      Promise.resolve(
        answered({ groups: [], answer_order: [] }, "claude-opus-5-5"),
      );

    const run = await triaged(client, owner, event.id);

    expect(run).toMatchObject({
      status: "SUCCEEDED",
      model: "claude-opus-5-5",
      inputTokens: 1_000,
      outputTokens: 100,
      // 1,000 × $4/M + 100 × $20/M = $0.006.
      costMicros: 6_000,
    });
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    expect(run.finishedAt).not.toBeNull();
  });

  it("gives up after 8 seconds, and Q&A carries on as if nothing happened (the exit criterion)", async () => {
    const { client, owner, event, asker } = await withQuestions([
      "Is it recorded?",
    ]);
    // A provider that never answers.
    model.answer = (_prompt, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    const startedAt = Date.now();

    const run = await triaged(client, owner, event.id);

    expect(Date.now() - startedAt).toBeLessThan(12_000);
    expect(run).toMatchObject({
      status: "TIMED_OUT",
      suggestions: null,
      failure: "The AI model did not answer within 8 seconds",
    });
    // Recorded for a timeout too: about 8 seconds. Timers fire on the
    // event loop's millisecond clock, which can run a little ahead of
    // performance.now(), so CI once measured 7,999.
    expect(run.latencyMs).toBeGreaterThanOrEqual(8_000 - 50);
    expect(run.latencyMs).toBeLessThan(12_000);
    // Asking, voting and listing work as before.
    const later = await asked(asker, event.slug, "And slides?");
    expect((await vote(asker, event.slug, later.id)).status).toBe(200);
    expect(
      QuestionList.parse(
        (await client.get(owner, `/events/${event.id}/questions`)).body,
      ).items,
    ).toHaveLength(2);
    // And another run may start.
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    expect((await triaged(client, owner, event.id)).status).toBe("SUCCEEDED");
  });

  const billed = [
    { model: "claude-opus-5-5", inputTokens: 1_000, outputTokens: 100 },
  ];

  it.each([
    [
      "a provider error",
      () =>
        Promise.reject(
          new TriageModelError("UNAVAILABLE", "The AI provider answered 529"),
        ),
      "The AI provider answered 529",
      "NOTHING",
    ],
    [
      "a refusal",
      () =>
        Promise.reject(
          new TriageModelError(
            "REFUSED",
            "The AI model declined to sort these questions",
            billed,
          ),
        ),
      "The AI model declined to sort these questions",
      "ITS COST",
    ],
    [
      "an answer cut off at its output allowance",
      () =>
        Promise.reject(
          new TriageModelError(
            "MALFORMED",
            "The AI model's answer was incomplete",
            billed,
          ),
        ),
      "The AI model's answer was incomplete",
      "ITS COST",
    ],
    [
      "an answer whose usage could not be read",
      () =>
        Promise.reject(
          new TriageModelError(
            "MALFORMED",
            "The AI model's answer was not in the expected form",
            "UNKNOWN",
          ),
        ),
      "The AI model's answer was not in the expected form",
      "ITS WORST COST",
    ],
    [
      "suggestions naming a question it was not given",
      (prompt: string) => {
        const a = labelOf(prompt, "Can I bring a guest?");
        return Promise.resolve(
          answered({
            groups: [{ representative: a, questions: [a, "q99"], reason: "" }],
            answer_order: [],
          }),
        );
      },
      "The AI model's suggestions did not match the questions",
      "ITS COST",
    ],
    [
      "something unexpected",
      () => Promise.reject(new Error("boom")),
      "AI suggestions are unavailable",
      "ITS WORST COST",
    ],
  ] as const)(
    "records %s as a failure, changes nothing, and counts what it was billed",
    async (_label, answer, failure, spend) => {
      const { client, owner, event } = await withQuestions([
        "Can I bring a guest?",
      ]);
      model.answer = answer;

      const runId = await started(client, owner, event.id);
      const { reserved } = await spentToday(client, owner);
      await worker.get(TriageRunner).run(runId);
      const run = await runOf(client, owner, runId);

      expect(run).toMatchObject({
        status: "FAILED",
        suggestions: null,
        failure,
      });
      expect((await decide(client, owner, run.id, [])).status).toBe(409);
      // 1,000 × $4/M + 100 × $20/M when billed.
      const expected = {
        NOTHING: 0,
        "ITS COST": 6_000,
        "ITS WORST COST": reserved,
      }[spend];
      expect(await spentToday(client, owner)).toEqual({
        runs: 1,
        spent: expected,
        reserved: 0,
      });
      if (spend === "ITS COST") {
        expect(run.costMicros).toBe(6_000);
      }
    },
  );

  it("records the last model to answer, and every attempt's cost, for a refusal after a fallback", async () => {
    const { client, owner, event } = await withQuestions([
      "Can I bring a guest?",
    ]);
    model.answer = () =>
      Promise.reject(
        new TriageModelError(
          "REFUSED",
          "The AI model declined to sort these questions",
          [
            { model: "claude-opus-5-5", inputTokens: 1_000, outputTokens: 100 },
            { model: "claude-opus-4-8", inputTokens: 1_000, outputTokens: 100 },
          ],
        ),
      );

    const run = await triaged(client, owner, event.id);

    // $4/M and $20/M, then $5/M and $25/M.
    expect(run).toMatchObject({
      model: "claude-opus-4-8",
      inputTokens: 2_000,
      outputTokens: 200,
      costMicros: 6_000 + 7_500,
    });
  });

  it("is unavailable, and Q&A unaffected, when no model is configured", async () => {
    const off = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
      },
      mailer,
      triageModel: null,
    });
    try {
      const client = new ApiClient(off, newAddress());
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);

      const refused = await client.send(
        owner,
        "post",
        `/events/${event.id}/question-triage-runs`,
      );

      expect(ProblemDetails.parse(refused.body).code).toBe(
        "TRIAGE_UNAVAILABLE",
      );
      expect(refused.status).toBe(503);
      expect(
        (await client.get(owner, `/events/${event.id}/questions`)).status,
      ).toBe(200);
    } finally {
      await off.close();
    }
  });

  it("runs one at a time per event: asking again, even at once, gets the same run", async () => {
    const { client, owner, event } = await withQuestions([
      "Where are the slides?",
    ]);

    const ids = await Promise.all([
      started(client, owner, event.id),
      started(client, owner, event.id),
      started(client, owner, event.id),
    ]);

    expect(new Set(ids).size).toBe(1);
    expect(
      await database.query("SELECT 1 FROM triage_runs WHERE event_id = $1", [
        event.id,
      ]),
    ).toHaveLength(1);
  });

  it("runs one at a time per event when two starts meet on the event's lock", async () => {
    const { client, owner, event } = await withQuestions([
      "Where is the venue?",
    ]);
    const block = await holdLock(
      database.url,
      "SELECT 1 FROM events WHERE id = $1 FOR UPDATE",
      [event.id],
    );
    let ids: string[];
    try {
      const both = Promise.all([
        started(client, owner, event.id),
        started(client, owner, event.id),
      ]);
      await block.waitForWaiters(2);
      await block.release();
      ids = await both;
    } catch (error) {
      await block.release().catch(() => undefined);
      throw error;
    }

    expect(new Set(ids).size).toBe(1);
    expect(
      await database.query("SELECT 1 FROM triage_runs WHERE event_id = $1", [
        event.id,
      ]),
    ).toHaveLength(1);
  });

  it("refuses to sort nothing", async () => {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner);

    const refused = await client.send(
      owner,
      "post",
      `/events/${event.id}/question-triage-runs`,
    );

    expect(ProblemDetails.parse(refused.body).code).toBe(
      "TRIAGE_NOTHING_TO_SORT",
    );
  });

  it("is decided once, only once it has suggestions, and only with its own groups", async () => {
    const { client, owner, event } = await withQuestions(pricing);
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b], reason: "" }],
          answer_order: [],
        }),
      );
    };
    const queued = await started(client, owner, event.id);
    const early = await decide(client, owner, queued, []);
    await worker.get(TriageRunner).run(queued);

    const unknown = await decide(client, owner, queued, [1]);
    const rejected = await decide(client, owner, queued, []);
    const again = await decide(client, owner, queued, [0]);

    expect(ProblemDetails.parse(early.body).code).toBe(
      "TRIAGE_ALREADY_DECIDED",
    );
    expect(ProblemDetails.parse(unknown.body).code).toBe("VALIDATION_FAILED");
    expect(TriageRun.parse(rejected.body).decision).toBe("REJECTED");
    expect(ProblemDetails.parse(again.body).code).toBe(
      "TRIAGE_ALREADY_DECIDED",
    );
    expect(
      await database.query(
        "SELECT 1 FROM questions WHERE merged_into_id IS NOT NULL AND event_id = $1",
        [event.id],
      ),
    ).toEqual([]);
  });

  it("merges against the questions as they are when decided", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [howMuch, price, free] = questions;
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      const c = labelOf(prompt, "Is there a free tier?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b, c], reason: "" }],
          answer_order: [],
        }),
      );
    };
    const run = await triaged(client, owner, event.id);
    // Since the run, one of them was deleted.
    await database.query("DELETE FROM questions WHERE id = $1", [free?.id]);

    const decided = await decide(client, owner, run.id, [0]);

    expect(TriageRun.parse(decided.body).decision).toBe("ACCEPTED");
    const rows = await database.query<{
      id: string;
      merged_into_id: string | null;
    }>(
      "SELECT id, merged_into_id FROM questions WHERE event_id = $1 ORDER BY created_at",
      [event.id],
    );
    expect(rows).toEqual([
      { id: howMuch?.id, merged_into_id: null },
      { id: price?.id, merged_into_id: howMuch?.id },
    ]);
  });

  it("leaves merged questions out of the next run", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [howMuch, price, free] = questions;
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b], reason: "" }],
          answer_order: [],
        }),
      );
    };
    const first = await triaged(client, owner, event.id);
    await decide(client, owner, first.id, [0]);
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));

    const second = await triaged(client, owner, event.id);

    expect(second.questionCount).toBe(2);
    const [row] = await database.query<{ question_ids: string[] }>(
      "SELECT question_ids FROM triage_runs WHERE id = $1",
      [second.id],
    );
    expect([...(row?.question_ids ?? [])].sort()).toEqual(
      [howMuch?.id, free?.id].sort(),
    );
    expect(model.sent.at(-1)).not.toContain("What is the price?");
    expect(price).toBeDefined();
  });

  it("changes nothing in an archived event", async () => {
    const { client, owner, event } = await withQuestions(pricing);
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b], reason: "" }],
          answer_order: [],
        }),
      );
    };
    const run = await triaged(client, owner, event.id);
    for (const to of ["CANCELLED", "ARCHIVED"]) {
      const moved = await client.send(
        owner,
        "post",
        `/events/${event.id}/transitions`,
        { to },
      );
      expect(moved.status, moved.text).toBe(200);
    }

    const decided = await decide(client, owner, run.id, [0]);
    const restarted = await client.send(
      owner,
      "post",
      `/events/${event.id}/question-triage-runs`,
    );

    expect(ProblemDetails.parse(decided.body).code).toBe("EVENT_ARCHIVED");
    expect(ProblemDetails.parse(restarted.body).code).toBe("EVENT_ARCHIVED");
    expect(
      await database.query(
        "SELECT 1 FROM questions WHERE merged_into_id IS NOT NULL AND event_id = $1",
        [event.id],
      ),
    ).toEqual([]);
  });

  /** Accepts the pricing group: "How much…" kept, "What is the price?" merged. */
  const groupPricing = () => {
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b], reason: "" }],
          answer_order: [],
        }),
      );
    };
  };

  const moderate = (
    client: ApiClient,
    owner: TestSession,
    question: Question,
    change: object,
  ) =>
    client
      .send(owner, "patch", `/questions/${question.id}`, change)
      .set("If-Match", `"${String(question.version)}"`);

  async function current(
    client: ApiClient,
    owner: TestSession,
    eventId: string,
    id: string,
  ) {
    const list = QuestionList.parse(
      (await client.get(owner, `/events/${eventId}/questions`)).body,
    );
    const found = list.items.find((item) => item.id === id);
    if (found === undefined) {
      throw new Error("No such question");
    }
    return found;
  }

  it("never merges a public question into one hidden since the run", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [howMuch, price] = questions;
    groupPricing();
    const run = await triaged(client, owner, event.id);
    const hidden = await moderate(client, owner, need(howMuch), {
      status: "HIDDEN",
    });
    expect(hidden.status, hidden.text).toBe(200);

    const decided = await decide(client, owner, run.id, [0]);

    expect(TriageRun.parse(decided.body)).toMatchObject({
      decision: "PARTIAL",
      mergedCount: 0,
    });
    expect(
      (await current(client, owner, event.id, price?.id ?? "")).mergedIntoId,
    ).toBeNull();
    const viewer = await attendee(event.slug);
    expect(
      QuestionList.parse(
        (await viewer.get(`/public/events/${event.slug}/questions`)).body,
      ).items.map(({ id }) => id),
    ).toContain(price?.id);
  });

  it("never merges into a question still waiting for approval", async () => {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner);
    const current_ = await client.get(owner, `/events/${event.id}`);
    await client
      .send(owner, "patch", `/events/${event.id}`, {
        questionsPreModerated: true,
      })
      .set("If-Match", String(current_.headers.etag));
    const asker = await attendee(event.slug);
    // Pending: asked while questions wait for approval.
    const howMuch = await asked(asker, event.slug, "How much does it cost?");
    // Published by a moderator.
    const price = await asked(asker, event.slug, "What is the price?");
    await moderate(client, owner, price, { status: "PUBLISHED" });
    groupPricing();
    const run = await triaged(client, owner, event.id);

    const decided = await decide(client, owner, run.id, [0]);

    expect(howMuch.status).toBe("PENDING");
    expect(TriageRun.parse(decided.body).mergedCount).toBe(0);
    expect(
      (await current(client, owner, event.id, price.id)).mergedIntoId,
    ).toBeNull();
  });

  it("leaves a member hidden since the run where it is", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [, price] = questions;
    groupPricing();
    const run = await triaged(client, owner, event.id);
    await moderate(client, owner, need(price), { status: "HIDDEN" });

    const decided = await decide(client, owner, run.id, [0]);

    expect(TriageRun.parse(decided.body)).toMatchObject({
      decision: "ACCEPTED",
      mergedCount: 0,
    });
    expect(
      (await current(client, owner, event.id, price?.id ?? "")).mergedIntoId,
    ).toBeNull();
  });

  it("unpins a merged question, freeing its slot, and never pins it again", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [, price, free] = questions;
    const pinned = await moderate(client, owner, need(price), { pinned: true });
    expect(Question.parse(pinned.body).pinSlot).toBe(1);
    groupPricing();
    const run = await triaged(client, owner, event.id);

    await decide(client, owner, run.id, [0]);

    const merged = await current(client, owner, event.id, price?.id ?? "");
    expect(merged.pinSlot).toBeNull();
    const again = await moderate(client, owner, merged, { pinned: true });
    expect(ProblemDetails.parse(again.body).code).toBe("QUESTION_NOT_PINNABLE");
    // Its slot is free for another.
    const other = await moderate(client, owner, need(free), { pinned: true });
    expect(Question.parse(other.body).pinSlot).toBe(1);
  });

  it("times out a model that ignores the run's signal", async () => {
    const { client, owner, event } = await withQuestions([
      "Will it be recorded?",
    ]);
    // Never answers, and never listens.
    model.answer = () => new Promise<never>(() => undefined);
    const startedAt = Date.now();

    const run = await triaged(client, owner, event.id);

    expect(Date.now() - startedAt).toBeLessThan(12_000);
    expect(run).toMatchObject({
      status: "TIMED_OUT",
      failure: "The AI model did not answer within 8 seconds",
    });
    // It may have been billed: its worst cost stays counted.
    const day = await spentToday(client, owner);
    expect(day.reserved).toBe(0);
    expect(day.spent).toBeGreaterThan(0);
  });

  it("sends no question hidden since the run was asked for, and calls no model when none is left", async () => {
    const { client, owner, event, questions } = await withQuestions(pricing);
    const [howMuch, price, free] = questions;
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    const runId = await started(client, owner, event.id);
    await moderate(client, owner, need(free), { status: "HIDDEN" });

    await worker.get(TriageRunner).run(runId);

    expect(model.sent.at(-1)).not.toContain("Is there a free tier?");
    expect(model.sent.at(-1)).toContain("What is the price?");

    // All of them hidden before the next run: the model is not called.
    const sentBefore = model.sent.length;
    const secondId = await started(client, owner, event.id);
    await moderate(
      client,
      owner,
      await current(client, owner, event.id, howMuch?.id ?? ""),
      { status: "HIDDEN" },
    );
    await moderate(
      client,
      owner,
      await current(client, owner, event.id, price?.id ?? ""),
      { status: "HIDDEN" },
    );
    await worker.get(TriageRunner).run(secondId);

    expect(model.sent).toHaveLength(sentBefore);
    expect(await runOf(client, owner, secondId)).toMatchObject({
      status: "FAILED",
      failure: "Every question was answered, hidden or merged before the run",
    });
  });

  it("sends the newest 200 when more questions are open", async () => {
    const { client, owner, event } = await withQuestions([
      "The first question",
    ]);
    const userId = (await client.me(owner)).user.id;
    await database.query(
      `INSERT INTO questions (event_id, author_user_id, body, status, created_at)
       SELECT $1, $2, 'Question ' || n, 'PUBLISHED', now() + n * interval '1 second'
       FROM generate_series(1, 210) AS n`,
      [event.id, userId],
    );
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));

    const run = await triaged(client, owner, event.id);

    expect(run).toMatchObject({ status: "SUCCEEDED", questionCount: 200 });
    expect(model.sent.at(-1)).not.toContain("The first question");
  });

  /** The workspace's spend today, from the ledger. */
  async function spentToday(client: ApiClient, owner: TestSession) {
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    const [row] = await database.query<{
      runs: number;
      spent: string;
      reserved: string;
    }>(
      `SELECT runs, spent_micros::text AS spent, reserved_micros::text AS reserved
       FROM triage_spend WHERE workspace_id = $1
       AND day = (now() AT TIME ZONE 'Europe/London')::date`,
      [workspaceId],
    );
    return {
      runs: row?.runs ?? 0,
      spent: Number(row?.spent ?? 0),
      reserved: Number(row?.reserved ?? 0),
    };
  }

  it("settles the day's spend when a run ends: its cost, or nothing when no model was called", async () => {
    const { client, owner, event, questions } = await withQuestions([
      "Is it free?",
    ]);
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    const runId = await started(client, owner, event.id);
    const whileRunning = await spentToday(client, owner);
    await worker.get(TriageRunner).run(runId);
    const afterRun = await spentToday(client, owner);
    // A second run whose questions were all hidden meanwhile: no model call.
    const second = await started(client, owner, event.id);
    await moderate(client, owner, need(questions[0]), { status: "HIDDEN" });
    await worker.get(TriageRunner).run(second);

    expect(whileRunning.runs).toBe(1);
    expect(whileRunning.reserved).toBeGreaterThan(6_000);
    // 1,000 × $4/M + 100 × $20/M.
    expect(afterRun).toEqual({ runs: 1, spent: 6_000, reserved: 0 });
    expect(await spentToday(client, owner)).toEqual({
      runs: 2,
      spent: 6_000,
      reserved: 0,
    });
  });

  it("refuses to start while its rate limit cannot be counted (Valkey down)", async () => {
    const down = await createTestApp({
      // No VALKEY_URL: the test default is a closed port.
      env: { DATABASE_URL: database.url, TRUST_PROXY_HOPS: "1" },
      triageModel: model,
    });
    try {
      const client = new ApiClient(down, newAddress());
      const owner = await client.newOwner();
      const event = await openEvent(client, owner);
      await database.query(
        `INSERT INTO questions (event_id, author_user_id, body, status)
         VALUES ($1, $2, 'Is it recorded?', 'PUBLISHED')`,
        [event.id, (await client.me(owner)).user.id],
      );

      const refused = await client.send(
        owner,
        "post",
        `/events/${event.id}/question-triage-runs`,
      );

      expect(refused.status).toBe(503);
      expect(ProblemDetails.parse(refused.body).code).toBe(
        "SERVICE_UNAVAILABLE",
      );
      expect(
        await database.query("SELECT 1 FROM triage_runs WHERE event_id = $1", [
          event.id,
        ]),
      ).toEqual([]);
    } finally {
      await down.close();
    }
  });

  it("refuses a vote that waited for the merge of its question", async () => {
    const { client, owner, event, asker, questions } =
      await withQuestions(pricing);
    const [howMuch, price] = questions;
    model.answer = (prompt) => {
      const a = labelOf(prompt, "How much does it cost?");
      const b = labelOf(prompt, "What is the price?");
      return Promise.resolve(
        answered({
          groups: [{ representative: a, questions: [a, b], reason: "" }],
          answer_order: [],
        }),
      );
    };
    const run = await triaged(client, owner, event.id);
    const block = await holdLock(
      database.url,
      "SELECT id FROM events WHERE id = $1 FOR UPDATE",
      [event.id],
    );
    let statuses: number[];
    try {
      const deciding = Promise.resolve(decide(client, owner, run.id, [0]));
      await block.waitForWaiters(1);
      const voting = Promise.resolve(vote(asker, event.slug, price?.id ?? ""));
      await block.waitForWaiters(2);
      await block.release();
      statuses = [(await deciding).status, (await voting).status];
    } catch (error) {
      await block.release().catch(() => undefined);
      throw error;
    }

    // The asker still sees the merged question (theirs), but may not vote.
    expect(statuses).toEqual([200, 409]);
    const [kept] = await database.query<{ vote_count: number }>(
      "SELECT vote_count FROM questions WHERE id = $1",
      [howMuch?.id],
    );
    expect(kept?.vote_count).toBe(0);
  });

  it("finds the event's latest run, so a moderator who comes back sees it", async () => {
    const { client, owner, event } = await withQuestions([
      "Is there a replay?",
    ]);
    const none = await client.get(
      owner,
      `/events/${event.id}/question-triage-runs/latest`,
    );
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    const first = await triaged(client, owner, event.id);
    await decide(client, owner, first.id, []);
    const second = await started(client, owner, event.id);

    const latest = await client.get(
      owner,
      `/events/${event.id}/question-triage-runs/latest`,
    );

    expect(none.status).toBe(404);
    expect(TriageRun.parse(latest.body)).toMatchObject({
      id: second,
      status: "QUEUED",
    });
  });

  it("is for Managers and Owners of the event's workspace only", async () => {
    const { client, owner, event } = await withQuestions(["Is there parking?"]);
    const manager = await memberOf(client, mailer, owner, "MANAGER");
    const analyst = await memberOf(client, mailer, owner, "ANALYST");
    const stranger = await client.newOwner("stranger");
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    const runId = await started(client, manager, event.id);
    await worker.get(TriageRunner).run(runId);

    const calls = (session: TestSession) => [
      client.send(session, "post", `/events/${event.id}/question-triage-runs`),
      client.get(session, `/question-triage-runs/${runId}`),
      client.get(session, `/events/${event.id}/question-triage-runs/latest`),
      decide(client, session, runId, []),
    ];
    const analysts = await Promise.all(calls(analyst));
    const strangers = await Promise.all(calls(stranger));

    expect(analysts.map(({ status }) => status)).toEqual([403, 403, 403, 403]);
    expect(strangers.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
    expect((await runOf(client, manager, runId)).status).toBe("SUCCEEDED");
    expect((await decide(client, owner, runId, [])).status).toBe(200);
  });

  it("runs as the worker's job, from the outbox", async () => {
    const { client, owner, event } = await withQuestions(["Is it free?"]);
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    const runId = await started(client, owner, event.id);
    const [message] = await database.query<{ payload: { runId: string } }>(
      "SELECT payload FROM outbox_messages WHERE type = 'triage.requested' AND payload->>'runId' = $1",
      [runId],
    );

    await worker
      .get(TriageConsumer)
      .process({ name: "run", data: message?.payload });
    // Run twice (a retried job): nothing more happens.
    await worker
      .get(TriageConsumer)
      .process({ name: "run", data: message?.payload });

    expect((await runOf(client, owner, runId)).status).toBe("SUCCEEDED");
    await expect(
      worker.get(TriageConsumer).process({ name: "other" }),
    ).rejects.toThrow(/Unknown triage job/);
  });

  it("settles a run once: a runner that finishes after the sweep closed its run changes nothing", async () => {
    const { client, owner, event } = await withQuestions(["Is it hybrid?"]);
    let answer: (value: TriageAnswer) => void = () => undefined;
    model.answer = () =>
      new Promise<TriageAnswer>((resolve) => {
        answer = resolve;
      });
    const runId = await started(client, owner, event.id);
    const { reserved } = await spentToday(client, owner);
    const sentBefore = model.sent.length;
    const running = worker.get(TriageRunner).run(runId);
    await expect.poll(() => model.sent.length).toBe(sentBefore + 1);

    // The worker seems lost: the sweep closes its run.
    await database.query(
      "UPDATE triage_runs SET started_at = now() - interval '2 minutes' WHERE id = $1",
      [runId],
    );
    await worker.get(TriageConsumer).process({ name: "sweep" });
    // Then the runner gets its answer after all.
    answer(answered({ groups: [], answer_order: [] }));
    await running;

    expect(await runOf(client, owner, runId)).toMatchObject({
      status: "TIMED_OUT",
      failure: "The run was interrupted",
      costMicros: null,
    });
    expect(await spentToday(client, owner)).toEqual({
      runs: 1,
      spent: reserved,
      reserved: 0,
    });
  });

  it("counts the reservation of a run deleted with its event as spent, once, and only that", async () => {
    const { client, owner, event } = await withQuestions(["Is there lunch?"]);
    // A run that ended earlier today: its reservation was settled, though
    // the run still records it.
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    expect((await triaged(client, owner, event.id)).status).toBe("SUCCEEDED");
    // A run still waiting, counted yesterday, in another of its events.
    const other = await openEvent(client, owner);
    await database.query(
      `INSERT INTO triage_runs (event_id, question_ids, reserved_micros, spend_day)
       VALUES ($1, ARRAY[uuidv7()], 1000000, (now() AT TIME ZONE 'Europe/London')::date - 1)`,
      [other.id],
    );
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    await database.query(
      `INSERT INTO triage_spend (workspace_id, day, runs, reserved_micros)
       VALUES ($1, (now() AT TIME ZONE 'Europe/London')::date - 1, 1, 1000000)`,
      [workspaceId],
    );
    // And one running now, in a third event.
    const third = await openEvent(client, owner);
    await asked(await attendee(third.slug), third.slug, "Is there tea?");
    const runningId = await started(client, owner, third.id);
    await database.query(
      "UPDATE triage_runs SET status = 'RUNNING', started_at = now() WHERE id = $1",
      [runningId],
    );
    const { reserved: running } = await spentToday(client, owner);
    const runId = await started(client, owner, event.id);
    const { reserved: both, spent } = await spentToday(client, owner);
    const reserved = both - running;
    // What the demo's reset does: the run goes with its event, unsettled.
    await database.query("DELETE FROM triage_runs WHERE id = $1", [runId]);

    await worker.get(TriageConsumer).process({ name: "sweep" });
    await worker.get(TriageConsumer).process({ name: "sweep" });

    expect(spent).toBe(6_000);
    expect(await spentToday(client, owner)).toEqual({
      runs: 3,
      spent: 6_000 + reserved,
      reserved: running,
    });
    const [yesterday] = await database.query<{
      spent: string;
      reserved: string;
    }>(
      `SELECT spent_micros::text AS spent, reserved_micros::text AS reserved
       FROM triage_spend WHERE workspace_id = $1
       AND day = (now() AT TIME ZONE 'Europe/London')::date - 1`,
      [workspaceId],
    );
    expect(yesterday).toEqual({ spent: "0", reserved: "1000000" });
  });

  it("counts an orphaned reservation once when two sweeps overlap, keeping a live run's", async () => {
    const { client, owner, event } = await withQuestions(["Is there lunch?"]);
    const second = await openEvent(client, owner);
    await asked(await attendee(second.slug), second.slug, "Is there dinner?");
    const orphan = await started(client, owner, event.id);
    const { reserved: orphaned } = await spentToday(client, owner);
    const live = await started(client, owner, second.id);
    const { reserved: both } = await spentToday(client, owner);
    await database.query("DELETE FROM triage_runs WHERE id = $1", [orphan]);
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    const block = await holdLock(
      database.url,
      `SELECT 1 FROM triage_spend WHERE workspace_id = $1
       AND day = (now() AT TIME ZONE 'Europe/London')::date FOR UPDATE`,
      [workspaceId],
    );
    let sweeps: Promise<unknown>;
    try {
      sweeps = Promise.all([
        worker.get(TriageConsumer).process({ name: "sweep" }),
        worker.get(TriageConsumer).process({ name: "sweep" }),
      ]);
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }
    await sweeps;

    expect(await spentToday(client, owner)).toEqual({
      runs: 2,
      spent: orphaned,
      reserved: both - orphaned,
    });
    expect((await runOf(client, owner, live)).status).toBe("QUEUED");
  });

  it("counts nothing when the day holds less than its runs reserve", async () => {
    const { client, owner, event } = await withQuestions(["Is there coffee?"]);
    await started(client, owner, event.id);
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    await database.query(
      `UPDATE triage_spend SET reserved_micros = reserved_micros - 1000
       WHERE workspace_id = $1`,
      [workspaceId],
    );
    const before = await spentToday(client, owner);

    await worker.get(TriageConsumer).process({ name: "sweep" });

    expect(await spentToday(client, owner)).toEqual(before);
    expect(before.spent).toBe(0);
  });

  it("counts an orphan and a live run's cost once each when the sweep meets the run's settlement", async () => {
    const { client, owner, event } = await withQuestions(["Is there lunch?"]);
    const second = await openEvent(client, owner);
    await asked(await attendee(second.slug), second.slug, "Is there dinner?");
    const orphan = await started(client, owner, event.id);
    const { reserved: orphaned } = await spentToday(client, owner);
    const live = await started(client, owner, second.id);
    await database.query("DELETE FROM triage_runs WHERE id = $1", [orphan]);
    model.answer = () =>
      Promise.resolve(answered({ groups: [], answer_order: [] }));
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    const block = await holdLock(
      database.url,
      `SELECT 1 FROM triage_spend WHERE workspace_id = $1
       AND day = (now() AT TIME ZONE 'Europe/London')::date FOR UPDATE`,
      [workspaceId],
    );
    let both: Promise<unknown>;
    try {
      both = Promise.all([
        // The run finishes: its settlement waits on the day's row.
        worker.get(TriageRunner).run(live),
        worker.get(TriageConsumer).process({ name: "sweep" }),
      ]);
      await block.waitForWaiters(2);
    } finally {
      await block.release();
    }
    await both;

    expect((await runOf(client, owner, live)).status).toBe("SUCCEEDED");
    // 1,000 × $4/M + 100 × $20/M for the run that answered.
    expect(await spentToday(client, owner)).toEqual({
      runs: 2,
      spent: orphaned + 6_000,
      reserved: 0,
    });
  });

  it("keeps a reservation made while the sweep counts what was orphaned", async () => {
    const { client, owner, event } = await withQuestions(["Is there lunch?"]);
    const orphan = await started(client, owner, event.id);
    const { reserved: orphaned } = await spentToday(client, owner);
    await database.query("DELETE FROM triage_runs WHERE id = $1", [orphan]);
    const workspaceId = (await client.me(owner)).activeWorkspace.workspaceId;
    // A start in progress: it holds the day's row, with a new run's
    // reservation not yet committed.
    const block = await holdLock(
      database.url,
      `UPDATE triage_spend SET runs = runs + 1, reserved_micros = reserved_micros + 7000
       WHERE workspace_id = $1 AND day = (now() AT TIME ZONE 'Europe/London')::date`,
      [workspaceId],
    );
    let sweeping: Promise<unknown>;
    try {
      await block.run(
        `INSERT INTO triage_runs (event_id, question_ids, reserved_micros, spend_day)
         VALUES ($1, ARRAY[uuidv7()], 7000, (now() AT TIME ZONE 'Europe/London')::date)`,
        [event.id],
      );
      sweeping = worker.get(TriageConsumer).process({ name: "sweep" });
      await block.waitForWaiters(1);
    } finally {
      await block.release();
    }
    await sweeping;

    expect(await spentToday(client, owner)).toEqual({
      runs: 2,
      spent: orphaned,
      reserved: 7_000,
    });
  });

  it("closes runs a worker left unfinished, so the event can triage again", async () => {
    const { client, owner, event } = await withQuestions(["Lunch?"]);
    const runId = await started(client, owner, event.id);
    await database.query(
      "UPDATE triage_runs SET status = 'RUNNING', started_at = now() - interval '61 seconds' WHERE id = $1",
      [runId],
    );
    const other = await withQuestions(["Dinner?"]);
    const queuedId = await started(other.client, other.owner, other.event.id);
    await database.query(
      "UPDATE triage_runs SET created_at = now() - interval '301 seconds' WHERE id = $1",
      [queuedId],
    );
    // Still within their time: left alone.
    const recent = await withQuestions(["Breakfast?"]);
    const recentRunning = await started(
      recent.client,
      recent.owner,
      recent.event.id,
    );
    await database.query(
      "UPDATE triage_runs SET status = 'RUNNING', started_at = now() - interval '55 seconds' WHERE id = $1",
      [recentRunning],
    );
    const late = await withQuestions(["Supper?"]);
    const recentQueued = await started(late.client, late.owner, late.event.id);
    await database.query(
      "UPDATE triage_runs SET created_at = now() - interval '290 seconds' WHERE id = $1",
      [recentQueued],
    );
    const reservedBefore = (await spentToday(client, owner)).reserved;

    await worker.get(TriageConsumer).process({ name: "sweep" });

    expect(await runOf(client, owner, runId)).toMatchObject({
      status: "TIMED_OUT",
      failure: "The run was interrupted",
    });
    expect(await runOf(other.client, other.owner, queuedId)).toMatchObject({
      status: "FAILED",
      failure: "The run never started",
    });
    expect(
      (await runOf(recent.client, recent.owner, recentRunning)).status,
    ).toBe("RUNNING");
    expect((await runOf(late.client, late.owner, recentQueued)).status).toBe(
      "QUEUED",
    );
    // An interrupted run may have been billed; one never started was not.
    expect(await spentToday(client, owner)).toMatchObject({
      reserved: 0,
      spent: reservedBefore,
    });
    expect((await spentToday(other.client, other.owner)).spent).toBe(0);
    expect(await started(client, owner, event.id)).not.toBe(runId);
  });
});
