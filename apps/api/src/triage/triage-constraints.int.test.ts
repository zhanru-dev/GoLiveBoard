import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedEvent } from "../testing/audience-seed.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";

/** What the database itself guarantees about a triage run (FR-RN-6). */
describe("triage run constraints", () => {
  let database: TestDatabase;
  let eventId: string;
  const question = "0193f2a4-0000-7000-8000-000000000001";

  beforeAll(async () => {
    database = await createTestDatabase();
    eventId = (
      await seedEvent(database, { startsAt: new Date(), status: "LIVE" })
    ).eventId;
  });

  afterAll(async () => {
    await database.drop();
  });

  /** A run with these columns set (others at their defaults). */
  const run = (columns: Record<string, unknown>) => {
    const values = { event_id: eventId, question_ids: [question], ...columns };
    const names = Object.keys(values);
    return database.query(
      `INSERT INTO triage_runs (${names.join(", ")})
       VALUES (${names.map((_, index) => `$${String(index + 1)}`).join(", ")})`,
      Object.values(values),
    );
  };

  it("takes a queued run of 1 to 200 questions", async () => {
    await run({});
    await expect(run({ question_ids: [] })).rejects.toThrow(
      /triage_runs_question_ids/,
    );
    await expect(
      run({ question_ids: Array.from({ length: 201 }, () => question) }),
    ).rejects.toThrow(/triage_runs_question_ids/);
  });

  it("has suggestions exactly when it succeeded, and a failure exactly when it failed", async () => {
    await run({
      status: "SUCCEEDED",
      suggestions: {},
      finished_at: new Date(),
    });
    await run({
      status: "TIMED_OUT",
      failure: "Too slow",
      finished_at: new Date(),
    });

    await expect(
      run({ status: "SUCCEEDED", finished_at: new Date() }),
    ).rejects.toThrow(/triage_runs_suggestions_when_succeeded/);
    await expect(run({ suggestions: {} })).rejects.toThrow(
      /triage_runs_suggestions_when_succeeded/,
    );
    await expect(
      run({ status: "FAILED", finished_at: new Date() }),
    ).rejects.toThrow(/triage_runs_failure_when_failed/);
    await expect(
      run({ status: "RUNNING", failure: "Not yet" }),
    ).rejects.toThrow(/triage_runs_failure_when_failed/);
  });

  it("is finished exactly when done, and decided only once it succeeded", async () => {
    await expect(run({ finished_at: new Date() })).rejects.toThrow(
      /triage_runs_finished_when_done/,
    );
    await expect(
      run({
        status: "FAILED",
        failure: "x",
        finished_at: new Date(),
        decision: "REJECTED",
        decided_at: new Date(),
      }),
    ).rejects.toThrow(/triage_runs_decided_when_succeeded/);
    await expect(
      run({
        status: "SUCCEEDED",
        suggestions: {},
        finished_at: new Date(),
        decision: "ACCEPTED",
      }),
    ).rejects.toThrow(/triage_runs_decided_when_succeeded/);
    await run({
      status: "SUCCEEDED",
      suggestions: {},
      finished_at: new Date(),
      decision: "PARTIAL",
      decided_at: new Date(),
      merged_count: 0,
    });
  });

  it("counts merges exactly once decided, and keeps the spend ledger's amounts whole", async () => {
    await expect(
      run({
        status: "SUCCEEDED",
        suggestions: {},
        finished_at: new Date(),
        decision: "ACCEPTED",
        decided_at: new Date(),
      }),
    ).rejects.toThrow(/triage_runs_merged_when_decided/);
    await expect(run({ merged_count: 1 })).rejects.toThrow(
      /triage_runs_merged_when_decided/,
    );
    const [{ workspace_id: workspaceId } = { workspace_id: "" }] =
      await database.query<{
        workspace_id: string;
      }>("SELECT workspace_id FROM events WHERE id = $1", [eventId]);
    await expect(
      database.query(
        "INSERT INTO triage_spend (workspace_id, day, reserved_micros) VALUES ($1, '2026-11-17', -1)",
        [workspaceId],
      ),
    ).rejects.toThrow(/triage_spend_amounts/);
  });

  it("refuses negative counts", async () => {
    for (const column of [
      "latency_ms",
      "input_tokens",
      "output_tokens",
      "cost_micros",
    ]) {
      await expect(run({ [column]: -1 })).rejects.toThrow(/triage_runs_counts/);
    }
  });
});
