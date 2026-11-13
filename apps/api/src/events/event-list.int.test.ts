import type { NestExpressApplication } from "@nestjs/platform-express";
import { EventDetail, EventPage, ProblemDetails } from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiClient, type TestSession } from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createTestApp } from "../testing/test-app.js";

/** An event starting on the given day of December 2026, lasting an hour. */
function eventOn(day: number, title = `Event ${String(day)}`) {
  const date = `2026-12-${String(day).padStart(2, "0")}`;
  return {
    title,
    startsAt: `${date}T18:00:00Z`,
    endsAt: `${date}T19:00:00Z`,
    timeZone: "Europe/London",
  };
}

describe("event list (FR-EV-3)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ env: { DATABASE_URL: database.url } });
    api = new ApiClient(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  async function create(session: TestSession, body: object) {
    const response = await api.send(session, "post", "/events", body);
    expect(response.status).toBe(201);
    return EventDetail.parse(response.body);
  }

  async function list(session: TestSession, query = "") {
    const response = await api.get(session, `/events${query}`);
    expect(response.status).toBe(200);
    return EventPage.parse(response.body);
  }

  const titles = (page: EventPage) => page.items.map((item) => item.title);

  it("lists only the active workspace's events, latest start first", async () => {
    const owner = await api.newOwner();
    await create(owner, eventOn(3));
    await create(owner, eventOn(10));
    await create(owner, eventOn(1));
    await create(await api.newOwner("other"), eventOn(5));

    const page = await list(owner);

    expect(titles(page)).toEqual(["Event 10", "Event 3", "Event 1"]);
    expect(page.nextCursor).toBeNull();
  });

  it("walks every page without gaps or repeats, also across equal start times", async () => {
    const owner = await api.newOwner();
    const days = [1, 2, 2, 2, 3, 4, 4];
    for (const [index, day] of days.entries()) {
      await create(owner, eventOn(day, `E${String(index)}`));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string =
        cursor === null ? "?limit=2" : `?limit=2&cursor=${cursor}`;
      const page = await list(owner, query);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBe(4);
    expect(new Set(seen).size).toBe(days.length);
    const all = await list(owner, "?limit=100");
    expect(seen).toEqual(all.items.map((item) => item.id));
  });

  it("searches titles without regard to case, treating % and _ literally", async () => {
    const owner = await api.newOwner();
    await create(owner, eventOn(1, "Quarterly All-Hands"));
    await create(owner, eventOn(2, "100% uptime review"));
    await create(owner, eventOn(3, "1000 users party"));
    await create(owner, eventOn(4, "snake_case meetup"));
    await create(owner, eventOn(5, "snakeXcase meetup"));

    expect(titles(await list(owner, "?q=all-HANDS"))).toEqual([
      "Quarterly All-Hands",
    ]);
    expect(
      titles(await list(owner, `?q=${encodeURIComponent("100%")}`)),
    ).toEqual(["100% uptime review"]);
    expect(titles(await list(owner, "?q=snake_case"))).toEqual([
      "snake_case meetup",
    ]);
  });

  it("filters by one or several statuses", async () => {
    const owner = await api.newOwner();
    const draft = await create(owner, eventOn(1, "Draft"));
    const ready = await create(owner, eventOn(2, "Ready"));
    await create(owner, eventOn(3, "Live"));
    await database.query("UPDATE events SET status = 'READY' WHERE id = $1", [
      ready.id,
    ]);
    await database.query(
      "UPDATE events SET status = 'LIVE' WHERE title = 'Live' AND workspace_id = (SELECT workspace_id FROM events WHERE id = $1)",
      [draft.id],
    );

    expect(titles(await list(owner, "?status=READY"))).toEqual(["Ready"]);
    expect(titles(await list(owner, "?status=READY&status=DRAFT"))).toEqual([
      "Ready",
      "Draft",
    ]);
  });

  it("filters by a start-time range that includes from and excludes to", async () => {
    const owner = await api.newOwner();
    for (const day of [1, 2, 3, 4]) {
      await create(owner, eventOn(day));
    }

    const page = await list(
      owner,
      "?from=2026-12-02T18:00:00Z&to=2026-12-04T18:00:00Z",
    );

    expect(titles(page)).toEqual(["Event 3", "Event 2"]);
  });

  it.each([
    ["a cursor that was not issued by the API", "?cursor=bm90LWEtY3Vyc29y"],
    ["a limit above 100", "?limit=101"],
    ["an unknown status", "?status=PAUSED"],
  ])("rejects %s", async (_label, query) => {
    const owner = await api.newOwner();

    const response = await api.get(owner, `/events${query}`);

    expect(response.status).toBe(400);
    expect(ProblemDetails.parse(response.body).code).toBe("VALIDATION_FAILED");
  });
});
