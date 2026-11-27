import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  Poll,
  PollList,
  type PollUpdated,
  ProblemDetails,
} from "@goliveboard/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import { openEvent, PublicClient, registration } from "../testing/admission.js";
import {
  ApiClient,
  type TestSession,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { cookieHeader } from "../testing/cookies.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { memberOf } from "../testing/events.js";
import { CapturingMailer } from "../testing/fakes.js";
import { listen, RealtimeClient } from "../testing/realtime.js";
import { createTestApp } from "../testing/test-app.js";

/** As fast as a question reaches everyone (FR-RN-2), give or take a window. */
const DELIVERY_MS = 2_000;

let addressCounter = 0;
const newAddress = () => `198.18.11.${String((addressCounter += 1) % 250)}`;

describe("live polls (FR-RN-8)", { timeout: 30_000 }, () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let second: NestExpressApplication;
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
    await listen(app);
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

  async function setUp() {
    const client = api();
    const owner = await client.newOwner();
    const event = await openEvent(client, owner);
    return { client, owner, event };
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
    return {
      browser: verified.attendee,
      cookie: cookieHeader({ [ATTENDEE_COOKIE]: token }),
    };
  }

  type Attendee = Awaited<ReturnType<typeof attendee>>;

  /** A connection on another instance, recording every poll it is sent. */
  async function watcher(cookie: string, slug: string) {
    const client = await RealtimeClient.connect(secondUrl, {
      cookie,
      ip: newAddress(),
    });
    clients.push(client);
    const received: PollUpdated["poll"][] = [];
    client.onPoll(({ poll }) => received.push(poll));
    await client.join(slug, 0, "QUESTIONS");
    return received;
  }

  async function draft(
    client: ApiClient,
    session: TestSession,
    eventId: string,
    options = ["Dashboards", "Webhooks", "Reports"],
  ) {
    const response = await client.send(
      session,
      "post",
      `/events/${eventId}/polls`,
      { question: "Which demo next?", options },
    );
    expect(response.status, response.text).toBe(201);
    return Poll.parse(response.body);
  }

  const run = (
    client: ApiClient,
    session: TestSession,
    poll: { id: string },
    action: "open" | "close",
  ) => client.send(session, "post", `/polls/${poll.id}/${action}`, {});

  const vote = (
    who: Attendee,
    slug: string,
    pollId: string,
    optionId: string,
  ) =>
    who.browser
      .put(`/public/events/${slug}/polls/${pollId}/vote`)
      .send({ optionId });

  const list = async (who: Attendee, slug: string) =>
    PollList.parse(
      (await who.browser.get(`/public/events/${slug}/polls`)).body,
    );

  const code = (response: { body: unknown }) =>
    ProblemDetails.parse(response.body).code;

  const option = (poll: Poll, index: number) => {
    const found = poll.options[index];
    if (found === undefined) throw new Error(`No option ${String(index)}`);
    return found.id;
  };

  it("opens a draft, takes one final answer per attendee, and tells everyone the counts", async () => {
    const { client, owner, event } = await setUp();
    const ada = await attendee(event.slug);
    const grace = await attendee(event.slug);
    const received = await watcher(grace.cookie, event.slug);

    const poll = await draft(client, owner, event.id);
    expect(poll).toMatchObject({ status: "DRAFT", totalVotes: 0, version: 1 });
    expect((await list(ada, event.slug)).items).toEqual([]);

    const opened = await run(client, owner, poll, "open");
    expect(opened.status, opened.text).toBe(200);
    await expect
      .poll(() => received.at(-1)?.status, { timeout: DELIVERY_MS })
      .toBe("OPEN");

    const answered = await vote(ada, event.slug, poll.id, option(poll, 1));
    expect(answered.status, answered.text).toBe(200);
    expect(Poll.parse(answered.body)).toMatchObject({
      totalVotes: 1,
      myOptionId: option(poll, 1),
    });
    expect(code(await vote(ada, event.slug, poll.id, option(poll, 0)))).toBe(
      "POLL_ALREADY_VOTED",
    );
    await expect
      .poll(() => received.at(-1)?.totalVotes, { timeout: DELIVERY_MS })
      .toBe(1);
    expect((await list(ada, event.slug)).items).toMatchObject([
      { id: poll.id, myOptionId: option(poll, 1) },
    ]);
    expect((await list(grace, event.slug)).items).toMatchObject([
      { id: poll.id, myOptionId: null },
    ]);

    const closed = await run(client, owner, poll, "close");
    expect(Poll.parse(closed.body).status).toBe("CLOSED");
    expect(code(await vote(grace, event.slug, poll.id, option(poll, 0)))).toBe(
      "POLL_NOT_OPEN",
    );
    const audit = await database.query<{ action: string }>(
      `SELECT action FROM audit_entries WHERE target_id = $1 ORDER BY created_at`,
      [poll.id],
    );
    expect(audit.map(({ action }) => action)).toEqual([
      "poll.created",
      "poll.opened",
      "poll.closed",
    ]);
  });

  it("gathers a burst of votes into a few announcements with the final count", async () => {
    const { client, owner, event } = await setUp();
    const voters = await Promise.all(
      Array.from({ length: 6 }, () => attendee(event.slug)),
    );
    const watching = await attendee(event.slug);
    const received = await watcher(watching.cookie, event.slug);
    const poll = await draft(client, owner, event.id);
    await run(client, owner, poll, "open");
    await expect.poll(() => received.length, { timeout: DELIVERY_MS }).toBe(1);

    const answers = await Promise.all(
      voters.map((who) => vote(who, event.slug, poll.id, option(poll, 0))),
    );

    expect(answers.map(({ status }) => status)).toEqual(voters.map(() => 200));
    await expect
      .poll(() => received.at(-1)?.totalVotes, { timeout: DELIVERY_MS })
      .toBe(6);
    // Opened, then at most a leading and a trailing announcement per window.
    expect(received.length - 1).toBeLessThan(6);
  });

  it("keeps one poll open per event, also when two open at the same moment", async () => {
    const { client, owner, event } = await setUp();
    const first = await draft(client, owner, event.id);
    const other = await draft(client, owner, event.id);

    const outcomes = await Promise.all([
      run(client, owner, first, "open"),
      run(client, owner, other, "open"),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(outcomes.filter(({ status }) => status === 409).map(code)).toEqual([
      "POLL_ALREADY_OPEN",
    ]);
  });

  it("edits and deletes only drafts, with their version; Analysts see polls but do not run them", async () => {
    const { client, owner, event } = await setUp();
    const poll = await draft(client, owner, event.id);
    const edit = (version: number, body: object) =>
      client
        .send(owner, "patch", `/polls/${poll.id}`, body)
        .set("If-Match", `"${String(version)}"`);

    expect((await edit(9, { question: "Stale?" })).status).toBe(412);
    const edited = await edit(1, { options: ["Yes", "No"] });
    expect(edited.status, edited.text).toBe(200);
    expect(Poll.parse(edited.body).options.map(({ label }) => label)).toEqual([
      "Yes",
      "No",
    ]);
    await run(client, owner, poll, "open");
    expect(code(await edit(3, { question: "Too late?" }))).toBe(
      "POLL_NOT_EDITABLE",
    );
    const removed = await client
      .send(owner, "delete", `/polls/${poll.id}`, undefined)
      .set("If-Match", '"3"');
    expect(code(removed)).toBe("POLL_NOT_EDITABLE");

    const analyst = await memberOf(client, mailer, owner, "ANALYST");
    expect(
      (await client.get(analyst, `/events/${event.id}/polls`)).status,
    ).toBe(200);
    const refused = await client.send(
      analyst,
      "post",
      `/events/${event.id}/polls`,
      { question: "Mine?", options: ["Yes", "No"] },
    );
    expect(refused.status).toBe(403);
  });

  it("refuses another poll's option, and closes the open poll when the event is cancelled", async () => {
    const { client, owner, event } = await setUp();
    const ada = await attendee(event.slug);
    const poll = await draft(client, owner, event.id);
    const elsewhere = await draft(client, owner, event.id, ["Left", "Right"]);
    await run(client, owner, poll, "open");

    expect(
      code(await vote(ada, event.slug, poll.id, option(elsewhere, 0))),
    ).toBe("POLL_OPTION_INVALID");

    const cancelled = await client.send(
      owner,
      "post",
      `/events/${event.id}/transitions`,
      { to: "CANCELLED" },
    );
    expect(cancelled.status, cancelled.text).toBe(200);
    const [row] = await database.query<{ status: string }>(
      "SELECT status::text AS status FROM polls WHERE id = $1",
      [poll.id],
    );
    expect(row?.status).toBe("CLOSED");
  });

  it("enforces one open poll per event and a vote's option, in plain SQL", async () => {
    const { client, owner, event } = await setUp();
    const poll = await draft(client, owner, event.id);
    const other = await draft(client, owner, event.id);
    await database.query(
      "UPDATE polls SET status = 'OPEN', opened_at = now() WHERE id = $1",
      [poll.id],
    );

    await expect(
      database.query(
        "UPDATE polls SET status = 'OPEN', opened_at = now() WHERE id = $1",
        [other.id],
      ),
    ).rejects.toThrow(/polls_one_open_per_event/);
    await expect(
      database.query("UPDATE polls SET status = 'CLOSED' WHERE id = $1", [
        other.id,
      ]),
    ).rejects.toThrow(/polls_times_match_status/);
    const [someone] = await database.query<{ id: string }>(
      "SELECT id FROM attendees LIMIT 1",
    );
    if (someone !== undefined) {
      await expect(
        database.query(
          "INSERT INTO poll_votes (poll_id, attendee_id, option_id) VALUES ($1, $2, $3)",
          [poll.id, someone.id, option(other, 0)],
        ),
      ).rejects.toThrow(/poll_votes_option_id_poll_id_fkey/);
    }
  });
});
