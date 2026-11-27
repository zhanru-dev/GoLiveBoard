import { writeFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page, WebSocketRoute } from "@playwright/test";

import { call, openEvent, unique } from "./api.js";
import { expect, test } from "./fixtures.js";
import { latestEmailTo, linkIn } from "./mailpit.js";
import { resetRateLimits } from "./rate-limits.js";

type Event = Awaited<ReturnType<typeof openEvent>>;

/**
 * Every real-time frame the attendees' pages send and receive. Their
 * browsers have no trace of their own, so a failed test gets these
 * attached (and written next to its other output).
 */
const recorded: { name: string; frames: string[] }[] = [];

test.beforeEach(() => {
  recorded.length = 0;
});

// Playwright reads fixtures from the first argument's pattern: none here.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }
  for (const [index, { name, frames }] of recorded.entries()) {
    const path = testInfo.outputPath(`frames-${String(index)}.txt`);
    await writeFile(path, frames.join("\n"));
    await testInfo.attach(`${name}: real-time frames`, {
      path,
      contentType: "text/plain",
    });
  }
});

function recordFrames(page: Page, name: string) {
  const frames: string[] = [];
  recorded.push({ name, frames });
  const started = Date.now();
  const at = () => `+${String(Date.now() - started)}ms`;
  page.on("websocket", (socket) => {
    frames.push(`${at()} open ${socket.url()}`);
    socket.on("framesent", ({ payload }) => {
      frames.push(`${at()} > ${String(payload)}`);
    });
    socket.on("framereceived", ({ payload }) => {
      frames.push(`${at()} < ${String(payload)}`);
    });
    socket.on("close", () => {
      frames.push(`${at()} closed`);
    });
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      frames.push(`${at()} navigated ${frame.url()}`);
    }
  });
}

/** A new browser that registers, confirms by email and is let in. */
async function attendee(browser: Browser, event: Event, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  recordFrames(page, name);
  const email = `attendee-${unique()}@example.com`;
  // Several attendees per test, all from the proxy's one address: start
  // each registration with fresh windows (registrations: ten an hour).
  resetRateLimits();
  await page.goto(`/e/${event.slug}`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel(/agree to it/).check();
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  await page.goto(linkIn(await latestEmailTo(email)));
  await expect(page.getByRole("status")).toContainText(
    `You are registered as ${name}`,
  );
  return { context, page, email };
}

async function openWatchPage(page: Page, event: Event) {
  await page.getByRole("link", { name: /Go to the event/ }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${event.slug}/watch$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(event.title);
  // Both channels joined: events now arrive live.
  await expect(
    page.getByText("Live: chat and questions update as they happen."),
  ).toBeVisible();
}

const chatLog = (page: Page) =>
  page.getByRole("log", { name: "Chat messages" });

async function say(page: Page, text: string) {
  await page.getByLabel("Your message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

/**
 * Says something and waits until the server has stored it (the sender's
 * log shows it, no longer "Sending…"): the next message is then stored
 * after it. Without the wait, messages sent quickly can be stored in
 * another order than they were typed.
 */
async function sayStored(page: Page, text: string) {
  await say(page, text);
  await expect(
    chatLog(page)
      .getByRole("listitem")
      .filter({ hasText: text })
      .filter({ hasNotText: "Sending" }),
  ).toBeVisible();
}

/** The texts of the chat's stored messages, in order. */
async function chatTexts(page: Page): Promise<string[]> {
  const items = await chatLog(page).getByRole("listitem").allInnerTexts();
  return items
    .map((text) => text.split("\n").at(-1) ?? "")
    .filter((text) => text !== "No messages yet.");
}

/**
 * Puts a page's real-time connection through a link the test controls:
 * while `cut` is on, nothing the server sends reaches the page (as on a
 * network that fails mid-way), and `drop()` ends the connection, as a
 * network that gives up does. Every reconnect goes through the link too.
 */
async function controlledLink(page: Page) {
  const link = {
    cut: false,
    current: undefined as WebSocketRoute | undefined,
    connections: 0,
    async drop() {
      await this.current?.close({ code: 1006, reason: "network down" });
    },
  };
  await page.routeWebSocket(/\/realtime\//, (socket) => {
    const server = socket.connectToServer();
    link.current = socket;
    link.connections += 1;
    socket.onMessage((message) => {
      server.send(message);
    });
    server.onMessage((message) => {
      if (!link.cut) {
        socket.send(message);
      }
    });
  });
  return link;
}

test("a dropped connection loses and duplicates no chat message (FR-RN-2)", async ({
  page,
  browser,
}) => {
  // Three browsers, an outage and a reconnect with backoff: more than the
  // default 30 s on a busy machine.
  test.setTimeout(60_000);
  const event = await openEvent(page.request);
  const ada = await attendee(browser, event, "Ada Lovelace");
  const grace = await attendee(browser, event, "Grace Hopper");
  const link = await controlledLink(ada.page);
  await openWatchPage(ada.page, event);
  await openWatchPage(grace.page, event);

  await sayStored(grace.page, "Before the outage");
  await expect(chatLog(ada.page)).toContainText("Before the outage");

  // The network fails: the server's messages no longer reach Ada.
  link.cut = true;
  for (const text of ["During 1", "During 2", "During 3"]) {
    await sayStored(grace.page, text);
  }
  // Ada writes too: her message reaches the server, its answer does not.
  await say(ada.page, "Ada during the outage");
  await expect(chatLog(grace.page)).toContainText("Ada during the outage");
  await expect(chatLog(ada.page)).not.toContainText("During 1");

  // The connection gives up; the page reconnects on a working network.
  link.cut = false;
  await link.drop();
  await expect.poll(() => link.connections).toBeGreaterThan(1);
  await sayStored(grace.page, "After the outage");

  // What the server stored, in its order (by sequence): each message once,
  // whatever was retried.
  const history = await page.request.get(
    `/api/v1/events/${event.id}/chat/messages`,
  );
  const { items } = (await history.json()) as { items: { body: string }[] };
  const stored = items.map(({ body }) => body);
  expect([...stored].sort()).toEqual(
    [
      "Before the outage",
      "During 1",
      "During 2",
      "During 3",
      "Ada during the outage",
      "After the outage",
    ].sort(),
  );
  // Both pages show exactly that, in that order: nothing lost, nothing twice.
  await expect
    .poll(() => chatTexts(ada.page), { timeout: 15_000 })
    .toEqual(stored);
  await expect.poll(() => chatTexts(grace.page)).toEqual(stored);
  await expect(chatLog(ada.page)).not.toContainText("Sending");

  await ada.context.close();
  await grace.context.close();
});

test("questions wait for a moderator, then everyone sees them and votes live (FR-RN-4, FR-RN-5)", async ({
  page,
  browser,
}) => {
  const event = await openEvent(page.request);
  const ada = await attendee(browser, event, "Ada Lovelace");
  const grace = await attendee(browser, event, "Grace Hopper");

  // The Manager makes questions wait for approval, in Launch Control.
  await page.goto(`/events/${event.id}`);
  await page.getByRole("checkbox", { name: /wait for approval/ }).check();
  await expect(
    page.getByRole("checkbox", { name: /wait for approval/ }),
  ).toBeChecked();
  await openWatchPage(ada.page, event);
  await openWatchPage(grace.page, event);

  await ada.page.getByLabel("Your question").fill("Will it ship on time?");
  await ada.page.getByRole("button", { name: "Ask" }).click();
  await expect(
    ada.page.getByText("Waiting for a moderator · Yours"),
  ).toBeVisible();
  await expect(page.getByText("Will it ship on time?")).toBeVisible();
  await expect(grace.page.getByText("Will it ship on time?")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Approve: Will it ship on time?" })
    .click();
  const vote = grace.page.getByRole("button", {
    name: "Vote for: Will it ship on time?",
  });
  await expect(vote).toBeVisible();
  await vote.click();
  await expect(vote).toHaveAttribute("aria-pressed", "true");

  await expect(
    ada.page.getByRole("button", { name: "Vote for: Will it ship on time?" }),
  ).toContainText("1");
  await expect(page.getByText(/Ada Lovelace · 1 vote$/)).toBeVisible();

  // A written answer reaches every attendee at once, and answers the question.
  await page
    .getByRole("button", { name: "Answer in writing: Will it ship on time?" })
    .click();
  await page.getByLabel("Your answer").fill("Yes, on 1 December.");
  await page.getByRole("button", { name: "Publish answer" }).click();
  await expect(grace.page.getByText("Yes, on 1 December.")).toBeVisible();
  await expect(ada.page.getByText("Yes, on 1 December.")).toBeVisible();
  await expect(vote).toHaveCount(0);

  await ada.context.close();
  await grace.context.close();
});

test("a revoked attendee's watch page says so within seconds (FR-AD-4)", async ({
  page,
  browser,
}) => {
  const event = await openEvent(page.request);
  const ada = await attendee(browser, event, "Ada Lovelace");
  await openWatchPage(ada.page, event);
  const listed = await page.request.get(`/api/v1/events/${event.id}/attendees`);
  const { items } = (await listed.json()) as { items: { id: string }[] };

  await call(
    page.request,
    "post",
    `/events/${event.id}/attendees/${items[0]?.id ?? ""}/revoke`,
    {},
  );

  await expect(
    ada.page.getByText("You have been signed out of this event."),
  ).toBeVisible({ timeout: 5_000 });
  await ada.context.close();
});

test("the watch page follows the event's status without a reload (FR-RN-1)", async ({
  page,
  browser,
}) => {
  const event = await openEvent(page.request);
  const ada = await attendee(browser, event, "Ada Lovelace");
  await openWatchPage(ada.page, event);
  await expect(ada.page.getByText(/has not started yet/)).toBeVisible();

  await call(page.request, "post", `/events/${event.id}/transitions`, {
    to: "CANCELLED",
  });

  // event.status arrives, the page reloads its data and, no longer
  // admitted, goes back to the event page, which says why.
  await expect(ada.page).toHaveURL(new RegExp(`/e/${event.slug}$`), {
    timeout: 5_000,
  });
  await expect(
    ada.page.getByText("This event has been cancelled."),
  ).toBeVisible();
  await ada.context.close();
});

test("the watch page has no WCAG 2.2 AA violations (NFR-6)", async ({
  page,
  browser,
}) => {
  const event = await openEvent(page.request);
  const ada = await attendee(browser, event, "Ada Lovelace");
  await openWatchPage(ada.page, event);

  const { violations } = await new AxeBuilder({ page: ada.page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target.join(" ")),
    })),
  ).toEqual([]);
  await ada.context.close();
});
