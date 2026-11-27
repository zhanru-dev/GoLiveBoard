import { randomUUID } from "node:crypto";

import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  ChannelJoined,
  Member,
  ProblemDetails,
  Question,
  QuestionList,
  QuestionsEvent,
} from "@goliveboard/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { ACCESS_COOKIE } from "../auth/cookies.js";
import { openEvent, PublicClient, registration } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { cookieHeader, setCookies } from "../testing/cookies.js";
import {
  createTestDatabase,
  holdLock,
  type TestDatabase,
} from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import { createTestApp, TEST_ORIGIN } from "../testing/test-app.js";
import { TEST_S3_BUCKET, TEST_S3_CREDENTIALS } from "../testing/containers.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "../demo/demo-accounts.js";
import { DEMO_QUESTION_LIMIT } from "../demo/demo-workspace.js";

/** FR-RN-2's delivery time, for questions too. */
const DELIVERY_MS = 1_000;

let addressCounter = 0;
const newAddress = () => `198.18.3.${String((addressCounter += 1) % 250)}`;

/** The item at `index`; fails the test if there is none. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No item at ${String(index)}`);
  }
  return item;
}

const staffCookie = (session: TestSession) =>
  cookieHeader({ [ACCESS_COOKIE]: session.access });

describe("Q&A (FR-RN-4, FR-RN-5)", { timeout: 30_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let second: NestExpressApplication;
  let url: string;
  let secondUrl: string;
  const mailer = new CapturingMailer();
  const clients: RealtimeClient[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    const env = {
      DATABASE_URL: database.url,
      VALKEY_URL: inject("valkeyUrl"),
      TRUST_PROXY_HOPS: "1",
    };
    app = await createTestApp({ env, mailer });
    second = await createTestApp({ env, mailer });
    url = await listen(app);
    secondUrl = await listen(second);
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    await app.close();
    await second.close();
    await database.drop();
  });

  const api = () => new ApiClient(app, newAddress());

  /** A connection on the event's Q&A, recording what it receives. */
  async function onQuestions(cookie: string, slug: string, at = url) {
    const client = await RealtimeClient.connect(at, {
      cookie,
      ip: newAddress(),
    });
    clients.push(client);
    const received: QuestionsEvent[] = [];
    client.onQuestions((event) => received.push(event));
    const joined = ChannelJoined.parse(await client.join(slug, 0, "QUESTIONS"));
    return { client, received, joined };
  }

  async function setUp(preModerated = false) {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner);
    if (preModerated) {
      const current = await client.get(owner, `/events/${event.id}`);
      const changed = await client
        .send(owner, "patch", `/events/${event.id}`, {
          questionsPreModerated: true,
        })
        .set("If-Match", String(current.headers.etag));
      expect(changed.status, changed.text).toBe(200);
    }
    return { api: client, owner, event };
  }

  async function attendee(slug: string) {
    const email = uniqueEmail("att");
    const browser = new PublicClient(app, newAddress());
    await browser.register(slug, registration(email));
    const verified = await browser.verify(
      tokenFromEmail(mailer.to(email).at(-1)?.text ?? ""),
    );
    const token = verified.attendee?.cookie(ATTENDEE_COOKIE);
    if (verified.attendee === undefined || token === undefined) {
      throw new Error(`Verification failed: ${verified.response.text}`);
    }
    const [row] = await database.query<{ id: string }>(
      "SELECT id FROM attendees WHERE email = $1",
      [email],
    );
    return {
      id: row?.id ?? "",
      browser: verified.attendee,
      cookie: cookieHeader({ [ATTENDEE_COOKIE]: token }),
    };
  }

  type Browser = Awaited<ReturnType<typeof attendee>>["browser"];

  const ask = (browser: Browser, slug: string, body: string, key?: string) => {
    const call = browser.post(`/public/events/${slug}/questions`, { body });
    return key === undefined ? call : call.set("Idempotency-Key", key);
  };

  async function asked(browser: Browser, slug: string, body = "Why?") {
    const response = await ask(browser, slug, body);
    expect(response.status, response.text).toBe(201);
    return Question.parse(response.body);
  }

  const vote = (browser: Browser, slug: string, id: string, on = true) =>
    on
      ? browser.put(`/public/events/${slug}/questions/${id}/vote`)
      : browser.delete(`/public/events/${slug}/questions/${id}/vote`);

  const moderate = (
    client: ApiClient,
    session: TestSession,
    question: { id: string; version: number },
    change: object,
    /** null sends no If-Match. */
    ifMatch: string | null = `"${String(question.version)}"`,
  ) => {
    const call = client.send(
      session,
      "patch",
      `/questions/${question.id}`,
      change,
    );
    return ifMatch === null ? call : call.set("If-Match", ifMatch);
  };

  const list = async (browser: Browser, slug: string) =>
    QuestionList.parse(
      (await browser.get(`/public/events/${slug}/questions`)).body,
    );

  const code = (response: { body: unknown }) =>
    ProblemDetails.parse(response.body).code;

  describe("asking", () => {
    it("reaches everyone on the Q&A, on every instance, within a second", async () => {
      const { owner, event } = await setUp();
      const visitor = await attendee(event.slug);
      const watcher = await onQuestions(
        (await attendee(event.slug)).cookie,
        event.slug,
      );
      const staff = await onQuestions(
        staffCookie(owner),
        event.slug,
        secondUrl,
      );
      const started = Date.now();

      const question = await asked(visitor.browser, event.slug, "  When?  ");

      expect(question).toMatchObject({
        body: "When?",
        status: "PUBLISHED",
        author: { kind: "ATTENDEE", name: "Ada Lovelace" },
        pinSlot: null,
        voteCount: 0,
        mine: true,
      });
      const { mine: _mine, ...seen } = question;
      for (const listener of [watcher, staff]) {
        await expect
          .poll(() => listener.received, { timeout: DELIVERY_MS, interval: 10 })
          .toEqual([{ sequence: 1, kind: "CREATED", question: seen }]);
      }
      expect(Date.now() - started).toBeLessThan(DELIVERY_MS);
      expect(await list(visitor.browser, event.slug)).toEqual({
        items: [{ ...question, mine: true, votedByMe: false }],
        latestSequence: 1,
      });
    });

    it("stores a retried question once with an idempotency key, and refuses the key for another", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      const key = randomUUID();

      const first = await ask(visitor.browser, event.slug, "Once", key);
      const retried = await ask(visitor.browser, event.slug, "Once", key);
      const other = await ask(visitor.browser, event.slug, "Other", key);

      expect(first.status).toBe(201);
      expect(retried.status).toBe(201);
      expect(retried.body).toEqual(first.body);
      expect(code(other)).toBe("IDEMPOTENCY_KEY_REUSED");
      const rows = await database.query(
        "SELECT 1 FROM questions WHERE event_id = $1",
        [event.id],
      );
      expect(rows).toHaveLength(1);
    });

    it("stores one question when two retries with the same key wait for the event together", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      const key = randomUUID();
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      let responses: { status: number; body: unknown }[];
      try {
        const asking = Promise.all([
          Promise.resolve(ask(visitor.browser, event.slug, "Once?", key)),
          Promise.resolve(ask(visitor.browser, event.slug, "Once?", key)),
        ]);
        await block.waitForWaiters(2);
        await block.release();
        responses = await asking;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      expect(responses.map(({ status }) => status)).toEqual([201, 201]);
      expect(responses[1]?.body).toEqual(responses[0]?.body);
      const rows = await database.query(
        "SELECT 1 FROM questions WHERE event_id = $1",
        [event.id],
      );
      expect(rows).toHaveLength(1);
    });

    it("is for the event's workspace and its admitted attendees only", async () => {
      const { event } = await setUp();
      const stranger = await api().newOwner("stranger");
      const other = await setUp();
      const otherVisitor = await attendee(other.event.slug);
      const otherQuestion = await asked(otherVisitor.browser, other.event.slug);
      const visitor = await attendee(event.slug);

      expect(
        (
          await api().send(stranger, "post", `/events/${event.id}/questions`, {
            body: "Not mine",
          })
        ).status,
      ).toBe(404);
      expect(
        (await ask(otherVisitor.browser, event.slug, "Not mine")).status,
      ).toBe(404);
      expect(
        (
          await otherVisitor.browser.get(
            `/public/events/${event.slug}/questions`,
          )
        ).status,
      ).toBe(404);
      // A question of another event, through this event's route.
      expect(
        (await vote(visitor.browser, event.slug, otherQuestion.id)).status,
      ).toBe(404);
      const rows = await database.query(
        "SELECT 1 FROM questions WHERE event_id = $1",
        [event.id],
      );
      expect(rows).toEqual([]);
    });

    it("lets Managers ask, but not Analysts", async () => {
      const { api: client, owner, event } = await setUp();
      const analyst = await memberOf(client, mailer, owner, "ANALYST");

      const managers = await client.send(
        owner,
        "post",
        `/events/${event.id}/questions`,
        { body: "From the team" },
      );
      const analysts = await client.send(
        analyst,
        "post",
        `/events/${event.id}/questions`,
        { body: "Me too" },
      );

      expect(Question.parse(managers.body).author.kind).toBe("STAFF");
      expect(analysts.status).toBe(403);
    });

    it("takes no questions once the event has ended", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      await database.query(
        "UPDATE events SET status = 'COMPLETED' WHERE id = $1",
        [event.id],
      );

      expect(code(await ask(visitor.browser, event.slug, "Late"))).toBe(
        "INTERACTION_CLOSED",
      );
    });

    it("limits how many questions one attendee asks", async () => {
      const { event } = await setUp();
      const visitor = await attendee(event.slug);
      for (let asked_ = 0; asked_ < 5; asked_ += 1) {
        await asked(visitor.browser, event.slug);
      }

      expect((await ask(visitor.browser, event.slug, "Sixth")).status).toBe(
        429,
      );
    });

    it.each([
      [
        "the attendee is revoked",
        "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE event_id = $1",
      ],
      [
        "the event is cancelled",
        "UPDATE events SET status = 'CANCELLED' WHERE id = $1",
      ],
    ])(
      "refuses a question when %s while it waits for the event",
      async (_label, change) => {
        const { event } = await setUp();
        const visitor = await attendee(event.slug);
        // Past the guard first, then held at the event's lock.
        const block = await holdLock(
          database.url,
          "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
          [event.id],
        );
        let status: number;
        try {
          const asking = Promise.resolve(
            ask(visitor.browser, event.slug, "Late"),
          );
          await block.waitForWaiters(1);
          await block.run(change, [event.id]);
          await block.release();
          status = (await asking).status;
        } catch (error) {
          await block.release().catch(() => undefined);
          throw error;
        }

        expect(status).toBe(403);
        const rows = await database.query(
          "SELECT 1 FROM questions WHERE event_id = $1",
          [event.id],
        );
        expect(rows).toEqual([]);
      },
    );
  });

  describe("pre-moderation (FR-RN-4)", () => {
    it("shows a new question only to its author and moderators until it is approved", async () => {
      const { api: client, owner, event } = await setUp(true);
      const author = await attendee(event.slug);
      const other = await attendee(event.slug);
      const authorLive = await onQuestions(author.cookie, event.slug);
      const otherLive = await onQuestions(other.cookie, event.slug);
      const moderator = await onQuestions(staffCookie(owner), event.slug);

      const question = await asked(author.browser, event.slug, "Pending?");

      expect(question.status).toBe("PENDING");
      const { mine: _mine, ...full } = question;
      for (const privileged of [authorLive, moderator]) {
        await expect
          .poll(() => privileged.received, { timeout: DELIVERY_MS })
          .toEqual([{ sequence: 1, kind: "CREATED", question: full }]);
      }
      await expect
        .poll(() => otherLive.received, { timeout: DELIVERY_MS })
        // Never public: not even its ID reaches them.
        .toEqual([{ sequence: 1, kind: "WITHDRAWN" }]);
      expect((await list(other.browser, event.slug)).items).toEqual([]);
      expect((await list(author.browser, event.slug)).items).toHaveLength(1);
      const staffList = QuestionList.parse(
        (await client.get(owner, `/events/${event.id}/questions`)).body,
      );
      expect(staffList.items.map(({ id }) => id)).toEqual([question.id]);

      const approved = await moderate(client, owner, question, {
        status: "PUBLISHED",
      });

      expect(approved.status, approved.text).toBe(200);
      await expect
        .poll(() => otherLive.received.at(-1), { timeout: DELIVERY_MS })
        .toMatchObject({
          sequence: 2,
          kind: "UPDATED",
          question: { id: question.id, status: "PUBLISHED" },
        });
      expect((await list(other.browser, event.slug)).items).toHaveLength(1);

      // Public once, so hiding it now names it: others must drop it.
      await moderate(client, owner, Question.parse(approved.body), {
        status: "HIDDEN",
      });
      await expect
        .poll(() => otherLive.received.at(-1), { timeout: DELIVERY_MS })
        .toEqual({ sequence: 3, kind: "WITHDRAWN", questionId: question.id });
    });

    it("publishes a moderator's own question at once", async () => {
      const { api: client, owner, event } = await setUp(true);

      const response = await client.send(
        owner,
        "post",
        `/events/${event.id}/questions`,
        { body: "From the stage" },
      );

      expect(Question.parse(response.body).status).toBe("PUBLISHED");
    });

    it("replays to each viewer what they may see", async () => {
      const { api: client, owner, event } = await setUp(true);
      const author = await attendee(event.slug);
      const pending = await asked(author.browser, event.slug, "Hidden");
      const published = await client.send(
        owner,
        "post",
        `/events/${event.id}/questions`,
        { body: "Open" },
      );
      const publishedId = Question.parse(published.body).id;

      const other = await onQuestions(
        (await attendee(event.slug)).cookie,
        event.slug,
      );
      const moderator = await onQuestions(staffCookie(owner), event.slug);
      const own = await onQuestions(author.cookie, event.slug);

      const seen = (replay: readonly unknown[]) =>
        replay.map((entry) => {
          const event = QuestionsEvent.parse(entry);
          return "question" in event
            ? `${String(event.sequence)} ${event.question.id}`
            : `${String(event.sequence)} withdrawn ${event.questionId ?? "-"}`;
        });
      expect(seen(other.joined.replay)).toEqual([
        "1 withdrawn -",
        `2 ${publishedId}`,
      ]);
      for (const privileged of [moderator, own]) {
        expect(seen(privileged.joined.replay)).toEqual([
          `1 ${pending.id}`,
          `2 ${publishedId}`,
        ]);
      }
    });
  });

  describe("voting (FR-RN-4)", () => {
    it("counts one vote per attendee, tells everyone, and takes it back", async () => {
      const { owner, event } = await setUp();
      const voter = await attendee(event.slug);
      const question = await asked(
        (await attendee(event.slug)).browser,
        event.slug,
      );
      const watcher = await onQuestions(staffCookie(owner), event.slug);

      const first = await vote(voter.browser, event.slug, question.id);
      const again = await vote(voter.browser, event.slug, question.id);

      expect(Question.parse(first.body)).toMatchObject({
        voteCount: 1,
        votedByMe: true,
      });
      expect(Question.parse(again.body).voteCount).toBe(1);
      await expect
        .poll(() => watcher.received.map(({ kind }) => kind), {
          timeout: DELIVERY_MS,
        })
        .toEqual(["VOTED"]);
      expect((await list(voter.browser, event.slug)).items[0]).toMatchObject({
        voteCount: 1,
        votedByMe: true,
      });

      const taken = await vote(voter.browser, event.slug, question.id, false);

      expect(Question.parse(taken.body)).toMatchObject({
        voteCount: 0,
        votedByMe: false,
      });
      // The version is for moderators: votes leave it alone.
      expect(Question.parse(taken.body).version).toBe(question.version);
    });

    it("counts every vote cast at the same moment exactly once", async () => {
      const { event } = await setUp();
      const voters = await Promise.all(
        Array.from({ length: 4 }, () => attendee(event.slug)),
      );
      const question = await asked(at(voters, 0).browser, event.slug);
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      try {
        const voting = Promise.all(
          voters.flatMap(({ browser }) => [
            Promise.resolve(vote(browser, event.slug, question.id)),
            Promise.resolve(vote(browser, event.slug, question.id)),
          ]),
        );
        // Twice each: 8 requests, within one instance's 10 connections.
        await block.waitForWaiters(8);
        await block.release();
        await voting;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      const [row] = await database.query<{ vote_count: number; votes: number }>(
        `SELECT vote_count,
                (SELECT count(*)::int FROM question_votes WHERE question_id = q.id) AS votes
         FROM questions AS q WHERE id = $1`,
        [question.id],
      );
      expect(row).toEqual({ vote_count: 4, votes: 4 });
    });

    it("takes votes on published questions only, from attendees only", async () => {
      const { api: client, owner, event } = await setUp(true);
      const voter = await attendee(event.slug);
      const author = await attendee(event.slug);
      const pending = await asked(author.browser, event.slug, "Pending");
      const ownPending = await asked(voter.browser, event.slug, "Mine");
      const staffQuestion = Question.parse(
        (
          await client.send(owner, "post", `/events/${event.id}/questions`, {
            body: "Answered",
          })
        ).body,
      );
      await moderate(client, owner, staffQuestion, { status: "ANSWERED" });

      // Someone else's pending question does not exist for the voter.
      expect((await vote(voter.browser, event.slug, pending.id)).status).toBe(
        404,
      );
      expect(code(await vote(voter.browser, event.slug, ownPending.id))).toBe(
        "QUESTION_NOT_VOTABLE",
      );
      expect(
        code(await vote(voter.browser, event.slug, staffQuestion.id)),
      ).toBe("QUESTION_NOT_VOTABLE");
      expect((await vote(voter.browser, event.slug, randomUUID())).status).toBe(
        404,
      );
    });

    it("refuses a vote when the attendee is revoked while it waits for the event", async () => {
      const { event } = await setUp();
      const voter = await attendee(event.slug);
      const question = await asked(
        (await attendee(event.slug)).browser,
        event.slug,
      );
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      let status: number;
      try {
        const voting = Promise.resolve(
          vote(voter.browser, event.slug, question.id),
        );
        await block.waitForWaiters(1);
        await block.run(
          "UPDATE attendees SET status = 'REVOKED', revoked_at = now() WHERE id = $1",
          [voter.id],
        );
        await block.release();
        status = (await voting).status;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      expect(status).toBe(403);
      const votes = await database.query(
        "SELECT 1 FROM question_votes WHERE question_id = $1",
        [question.id],
      );
      expect(votes).toEqual([]);
    });
  });

  describe("moderation (FR-RN-5)", () => {
    async function withQuestions(count: number) {
      const setup = await setUp();
      const questions: Question[] = [];
      for (let index = 0; index < count; index += 1) {
        const response = await setup.api.send(
          setup.owner,
          "post",
          `/events/${setup.event.id}/questions`,
          { body: `Question ${String(index)}` },
        );
        questions.push(Question.parse(response.body));
      }
      return { ...setup, questions };
    }

    it("hides, answers and publishes again, telling everyone and auditing it", async () => {
      const { api: client, owner, event, questions } = await withQuestions(1);
      const question = at(questions, 0);
      const watcher = await onQuestions(
        (await attendee(event.slug)).cookie,
        event.slug,
      );

      const hidden = await moderate(client, owner, question, {
        status: "HIDDEN",
      });

      expect(hidden.status, hidden.text).toBe(200);
      expect(hidden.headers.etag).toBe('"2"');
      await expect
        .poll(() => watcher.received, { timeout: DELIVERY_MS })
        .toEqual([{ sequence: 2, kind: "WITHDRAWN", questionId: question.id }]);
      const published = await moderate(
        client,
        owner,
        Question.parse(hidden.body),
        { status: "PUBLISHED" },
      );
      const answered = await moderate(
        client,
        owner,
        Question.parse(published.body),
        { status: "ANSWERED" },
      );
      expect(Question.parse(answered.body).status).toBe("ANSWERED");
      const audit = await database.query<{ before: object; after: object }>(
        `SELECT before, after FROM audit_entries
         WHERE action = 'question.moderated' AND target_id = $1 ORDER BY created_at`,
        [question.id],
      );
      expect(audit.map(({ after }) => after)).toEqual([
        { status: "HIDDEN", pinSlot: null, answer: null },
        { status: "PUBLISHED", pinSlot: null, answer: null },
        { status: "ANSWERED", pinSlot: null, answer: null },
      ]);
    });

    it("answers in writing: attendees see the answer at once, and reopening removes it", async () => {
      const { api: client, owner, event, questions } = await withQuestions(1);
      const question = at(questions, 0);
      const viewer = await attendee(event.slug);
      const watcher = await onQuestions(viewer.cookie, event.slug);

      const answered = await moderate(client, owner, question, {
        answer: "  Next week.  ",
      });

      expect(answered.status, answered.text).toBe(200);
      const first = Question.parse(answered.body);
      expect(first).toMatchObject({
        status: "ANSWERED",
        answer: { body: "Next week." },
      });
      await expect
        .poll(() => watcher.received.at(-1), { timeout: DELIVERY_MS })
        .toMatchObject({
          kind: "UPDATED",
          question: { id: question.id, answer: { body: "Next week." } },
        });
      expect((await list(viewer.browser, event.slug)).items).toMatchObject([
        { id: question.id, answer: { body: "Next week." } },
      ]);
      const edited = Question.parse(
        (await moderate(client, owner, first, { answer: "Tomorrow." })).body,
      );
      expect(edited.answer?.body).toBe("Tomorrow.");
      const reopened = Question.parse(
        (await moderate(client, owner, edited, { status: "PUBLISHED" })).body,
      );
      expect(reopened).toMatchObject({ status: "PUBLISHED", answer: null });
    });

    it("refuses an answer to a question not yet approved", async () => {
      const { api: client, owner, event } = await setUp(true);
      const pending = await asked(
        (await attendee(event.slug)).browser,
        event.slug,
      );

      expect(pending.status).toBe("PENDING");
      expect(
        code(await moderate(client, owner, pending, { answer: "Yes." })),
      ).toBe("QUESTION_STATUS_INVALID");
    });

    it("refuses a move the rules do not allow", async () => {
      const { api: client, owner, questions } = await withQuestions(1);
      const question = at(questions, 0);
      const hidden = Question.parse(
        (await moderate(client, owner, question, { status: "HIDDEN" })).body,
      );

      expect(
        code(await moderate(client, owner, hidden, { status: "ANSWERED" })),
      ).toBe("QUESTION_STATUS_INVALID");
      expect(
        code(await moderate(client, owner, hidden, { pinned: true })),
      ).toBe("QUESTION_NOT_PINNABLE");
    });

    it("pins three questions at most, and frees a slot when one is unpinned", async () => {
      const { api: client, owner, questions } = await withQuestions(4);
      const pinned: Question[] = [];
      for (const question of questions.slice(0, 3)) {
        pinned.push(
          Question.parse(
            (await moderate(client, owner, question, { pinned: true })).body,
          ),
        );
      }

      expect(pinned.map(({ pinSlot }) => pinSlot)).toEqual([1, 2, 3]);
      const fourth = at(questions, 3);
      expect(
        code(await moderate(client, owner, fourth, { pinned: true })),
      ).toBe("PIN_LIMIT_REACHED");
      await moderate(client, owner, at(pinned, 1), { pinned: false });
      const now = Question.parse(
        (await moderate(client, owner, fourth, { pinned: true })).body,
      );
      expect(now.pinSlot).toBe(2);
    });

    it("gives the last slot to one of two pins made at the same moment", async () => {
      const { api: client, owner, event, questions } = await withQuestions(4);
      for (const question of questions.slice(0, 2)) {
        await moderate(client, owner, question, { pinned: true });
      }
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      let responses: { status: number; body: unknown }[];
      try {
        const pinning = Promise.all(
          questions
            .slice(2)
            .map((question) =>
              Promise.resolve(
                moderate(client, owner, question, { pinned: true }),
              ),
            ),
        );
        await block.waitForWaiters(2);
        await block.release();
        responses = await pinning;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(
        code(responses.find(({ status }) => status === 409) ?? { body: {} }),
      ).toBe("PIN_LIMIT_REACHED");
      const slots = await database.query<{ pin_slot: number }>(
        "SELECT pin_slot FROM questions WHERE event_id = $1 AND pin_slot IS NOT NULL ORDER BY pin_slot",
        [event.id],
      );
      expect(slots.map(({ pin_slot }) => pin_slot)).toEqual([1, 2, 3]);
    });

    it("refuses one of two edits made from the same version with 412", async () => {
      const { api: client, owner, event, questions } = await withQuestions(1);
      const question = at(questions, 0);
      const block = await holdLock(
        database.url,
        "SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE",
        [event.id],
      );
      let responses: { status: number }[];
      try {
        const editing = Promise.all([
          Promise.resolve(
            moderate(client, owner, question, { status: "HIDDEN" }),
          ),
          Promise.resolve(moderate(client, owner, question, { pinned: true })),
        ]);
        await block.waitForWaiters(2);
        await block.release();
        responses = await editing;
      } catch (error) {
        await block.release().catch(() => undefined);
        throw error;
      }

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 412]);
    });

    it("needs If-Match, and the current version in it", async () => {
      const { api: client, owner, questions } = await withQuestions(1);
      const question = at(questions, 0);

      expect(
        (await moderate(client, owner, question, { pinned: true }, null))
          .status,
      ).toBe(428);
      expect(
        (await moderate(client, owner, question, { pinned: true }, '"9"'))
          .status,
      ).toBe(412);
      expect((await moderate(client, owner, question, {})).status).toBe(400);
    });

    it("is for Managers and Owners of the question's workspace only", async () => {
      const { api: client, owner, event, questions } = await withQuestions(1);
      const question = at(questions, 0);
      const analyst = await memberOf(client, mailer, owner, "ANALYST");
      const stranger = await client.newOwner("stranger");

      expect(
        (await moderate(client, analyst, question, { pinned: true })).status,
      ).toBe(403);
      expect(
        (await moderate(client, stranger, question, { pinned: true })).status,
      ).toBe(404);
      expect(
        (await client.get(stranger, `/events/${event.id}/questions`)).status,
      ).toBe(404);
      await database.query(
        "UPDATE events SET status = 'ARCHIVED' WHERE id = $1",
        [event.id],
      );
      expect(
        code(await moderate(client, owner, question, { pinned: true })),
      ).toBe("EVENT_ARCHIVED");
    });

    it("ends a moderator's Q&A connection when they lose the role, which decides what they see", async () => {
      const { api: client, owner, event } = await setUp();
      const manager = await memberOf(client, mailer, owner, "MANAGER");
      const live = await onQuestions(staffCookie(manager), event.slug);
      const members = z
        .array(Member)
        .parse((await client.get(owner, "/workspace/members")).body);
      const membership = members.find(({ email }) => email === manager.email);

      await client.send(
        owner,
        "patch",
        `/workspace/members/${membership?.membershipId ?? ""}`,
        { role: "ANALYST" },
      );

      await live.client.untilDisconnected(5_000);
      expect(live.client.revoked).toEqual([{ reason: "ACCESS_REVOKED" }]);
    });
  });

  it("stores a bounded number of questions per demo event", async () => {
    const demo = await createTestApp({
      env: {
        DATABASE_URL: database.url,
        VALKEY_URL: inject("valkeyUrl"),
        TRUST_PROXY_HOPS: "1",
        DEMO_MODE: "true",
        S3_ENDPOINT: inject("s3Endpoint"),
        S3_BUCKET: TEST_S3_BUCKET,
        S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
        S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
        S3_FORCE_PATH_STYLE: "true",
        S3_CREATE_BUCKET: "true",
      },
      mailer,
    });
    try {
      const signIn = await request(demo.getHttpServer())
        .post("/api/v1/auth/demo")
        .set("Origin", TEST_ORIGIN)
        .set("X-Forwarded-For", newAddress());
      const visitor: TestSession = {
        email: DEMO_PEOPLE.manager.email,
        access: setCookies(signIn).get(ACCESS_COOKIE)?.value ?? "",
        refresh: "",
      };
      const [event] = await database.query<{ id: string }>(
        `SELECT id FROM events
         WHERE workspace_id = $1 AND status IN ('CONFIGURING', 'READY', 'LIVE')
         ORDER BY slug LIMIT 1`,
        [DEMO_WORKSPACE.id],
      );
      await database.query(
        `INSERT INTO questions (event_id, author_user_id, body, status)
         SELECT $1, $2, 'Filler', 'PUBLISHED'
         FROM generate_series(1, $3::int - 1)`,
        [event?.id, DEMO_PEOPLE.manager.id, DEMO_QUESTION_LIMIT],
      );
      const client = new ApiClient(demo, newAddress());
      const askDemo = (body: string) =>
        client.send(visitor, "post", `/events/${event?.id ?? ""}/questions`, {
          body,
        });

      expect((await askDemo("The last one")).status).toBe(201);
      expect((await askDemo("One too many")).status).toBe(429);
    } finally {
      await demo.close();
    }
  });
});
