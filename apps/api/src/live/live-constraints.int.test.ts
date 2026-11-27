import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedAttendee, seedEvent } from "../testing/audience-seed.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";

/**
 * The invariants of live interaction that the database enforces (docs/03,
 * section 5), checked with plain SQL: the services' own checks come on top.
 */
describe("live interaction constraints", () => {
  let database: TestDatabase;
  let eventId: string;
  let attendeeId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    ({ eventId } = await seedEvent(database, {
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    }));
    ({ id: attendeeId } = await seedAttendee(database, eventId));
  });

  afterAll(async () => {
    await database.drop();
  });

  const question = (status = "PUBLISHED", pinSlot: number | null = null) =>
    database.query<{ id: string }>(
      `INSERT INTO questions (event_id, author_attendee_id, body, status, pin_slot)
       VALUES ($1, $2, 'Why?', $3::question_status, $4) RETURNING id`,
      [eventId, attendeeId, status, pinSlot],
    );

  it("holds at most three pinned questions per event, each in its own slot (FR-RN-5)", async () => {
    await question("PUBLISHED", 1);
    await question("ANSWERED", 2);
    await question("PUBLISHED", 3);

    await expect(question("PUBLISHED", 4)).rejects.toThrow(
      /questions_pin_slot_range/,
    );
    await expect(question("PUBLISHED", 2)).rejects.toThrow(
      /questions_pin_slot_key/,
    );
    await expect(question("HIDDEN", null)).resolves.toBeDefined();
  });

  it("pins only a published or answered question", async () => {
    const other = await seedEvent(database, {
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await expect(
      database.query(
        `INSERT INTO questions (event_id, body, status, pin_slot)
         VALUES ($1, 'Hidden', 'HIDDEN', 1)`,
        [other.eventId],
      ),
    ).rejects.toThrow(/questions_pinned_are_visible/);
  });

  it("takes one vote per attendee and question (FR-RN-4)", async () => {
    const [created] = await question();
    const vote = () =>
      database.query(
        "INSERT INTO question_votes (question_id, attendee_id) VALUES ($1, $2)",
        [created?.id, attendeeId],
      );

    await vote();
    await expect(vote()).rejects.toThrow(/question_votes_pkey/);
  });

  it("stores one message per author and client message ID (FR-RN-2)", async () => {
    const clientMessageId = randomUUID();
    const send = (sequence: number) =>
      database.query(
        `INSERT INTO chat_messages (event_id, sequence, author_attendee_id, client_message_id, body)
         VALUES ($1, $2, $3, $4, 'Hello')`,
        [eventId, sequence, attendeeId, clientMessageId],
      );

    await send(1);
    await expect(send(2)).rejects.toThrow(/chat_messages_client_key/);
    await expect(
      database.query(
        `INSERT INTO chat_messages (event_id, sequence, author_attendee_id, client_message_id, body)
         VALUES ($1, 1, $2, $3, 'Same place')`,
        [eventId, attendeeId, randomUUID()],
      ),
    ).rejects.toThrow(/chat_messages_event_id_sequence_key/);
  });

  it("keeps no text in a deleted message, and one author at most (FR-RN-3)", async () => {
    await expect(
      database.query(
        `INSERT INTO chat_messages (event_id, sequence, author_attendee_id, client_message_id, body, deleted_at)
         VALUES ($1, 90, $2, $3, 'still here', now())`,
        [eventId, attendeeId, randomUUID()],
      ),
    ).rejects.toThrow(/chat_messages_tombstone_has_no_text/);
    const [user] = await database.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, 'Ada', 'x') RETURNING id`,
      [`staff-${randomUUID()}@example.com`],
    );
    await expect(
      database.query(
        `INSERT INTO chat_messages (event_id, sequence, author_attendee_id, author_user_id, client_message_id, body)
         VALUES ($1, 91, $2, $3, $4, 'Two authors')`,
        [eventId, attendeeId, user?.id, randomUUID()],
      ),
    ).rejects.toThrow(/chat_messages_one_author/);
  });

  it("keeps one journal entry per channel and sequence", async () => {
    const entry = () =>
      database.query(
        `INSERT INTO realtime_journal (event_id, channel, sequence, kind, entity_id)
         VALUES ($1, 'CHAT', 7, 'MESSAGE_CREATED', $2)`,
        [eventId, randomUUID()],
      );

    await entry();
    await expect(entry()).rejects.toThrow(/realtime_journal_pkey/);
  });

  it("keeps a written answer with its time and length", async () => {
    const [answered] = await question("ANSWERED");
    await expect(
      database.query("UPDATE questions SET answer = 'Yes' WHERE id = $1", [
        answered?.id,
      ]),
    ).rejects.toThrow(/questions_answer_has_time/);
    await expect(
      database.query(
        "UPDATE questions SET answer = 'Yes', answered_at = now() WHERE id = $1",
        [answered?.id],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.query("UPDATE questions SET answer = '' WHERE id = $1", [
        answered?.id,
      ]),
    ).rejects.toThrow(/questions_answer_length/);
  });

  it("lets the release before answers reopen an answered question (expand and contract)", async () => {
    // A rollback runs that release on this schema: it reopens a question
    // by its status alone and knows nothing of the answer.
    const [answered] = await question("ANSWERED");
    await database.query(
      "UPDATE questions SET answer = 'Yes', answered_at = now() WHERE id = $1",
      [answered?.id],
    );
    await expect(
      database.query(
        "UPDATE questions SET status = 'PUBLISHED' WHERE id = $1",
        [answered?.id],
      ),
    ).resolves.toBeDefined();
  });
});
