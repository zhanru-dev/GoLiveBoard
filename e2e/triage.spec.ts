import AxeBuilder from "@axe-core/playwright";

import { call, openEvent } from "./api.js";
import { expect, test } from "./fixtures.js";
import { E2E_TARGET } from "./target.js";

/**
 * AI question triage (FR-RN-6) in a browser. The stack runs it with
 * AI_PROVIDER=offline (identical questions grouped, no model, no key); the
 * local target follows the developer's own .env, so it runs on the stack.
 */
test("a moderator merges the duplicates the suggestions found", async ({
  page,
}) => {
  test.skip(E2E_TARGET !== "stack", "The stack runs triage offline");
  const event = await openEvent(page.request);
  for (const body of [
    "Will the session be recorded?",
    "Will the session be recorded?",
    "Who is the keynote speaker?",
  ]) {
    await call(page.request, "post", `/events/${event.id}/questions`, {
      body,
    });
  }
  await page.goto(`/events/${event.id}`);
  const panel = page.getByRole("region", { name: "AI suggestions" });

  await panel.getByRole("button", { name: "Suggest groups" }).click();

  const group = panel.getByRole("checkbox");
  await expect(group).toHaveCount(1);
  await expect(panel.getByText("Suggested order to answer")).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include("section[aria-labelledby='triage-heading']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map(({ id }) => id)).toEqual([]);

  await group.check();
  await panel.getByRole("button", { name: "Merge selected" }).click();

  await expect(page.getByText("Merged 1 question")).toBeVisible();
  const moderation = page.getByRole("list", { name: "Questions to moderate" });
  await expect(
    moderation.getByText("Merged into “Will the session be recorded?”"),
  ).toBeVisible();
});
