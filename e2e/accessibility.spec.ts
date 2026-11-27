import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { openEvent } from "./api.js";
import { expect, test } from "./fixtures.js";
import { E2E_TARGET } from "./target.js";

/**
 * NFR-6: automated axe checks on every page, against WCAG 2.2 level AA.
 * The keyboard walkthrough of the golden flow is keyboard.spec.ts, reflow
 * and target size layout.spec.ts (docs/accessibility-audit.md).
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, path: string) {
  await page.goto(path);
  // Client-rendered pages settle on their main heading first.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG)
    .analyze();
  expect(
    violations.map(({ id, help, nodes }) => ({
      id,
      help,
      targets: nodes.map(({ target }) => target.join(" ")),
    })),
    path,
  ).toEqual([]);
}

test("pages without a session have no WCAG 2.2 AA violations", async ({
  page,
  browser,
}) => {
  // A page after page through axe: more than the default 30 s on a busy
  // runner, with nothing wrong.
  test.setTimeout(90_000);
  const event = await openEvent(page.request);
  const visitor = await (await browser.newContext()).newPage();
  const paths = [
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/invitations/accept",
    `/e/${event.slug}`,
    `/e/${event.slug}/verify`,
    "/reminders/unsubscribe",
    "/how-its-built",
    ...(E2E_TARGET === "stack" ? ["/demo-inbox"] : []),
  ];
  for (const path of paths) {
    await expectNoViolations(visitor, path);
  }
});

test("pages of the signed-in app have no WCAG 2.2 AA violations", async ({
  page,
}) => {
  // A page after page through axe: more than the default 30 s on a busy
  // runner, with nothing wrong.
  test.setTimeout(90_000);
  const event = await openEvent(page.request);

  for (const path of [
    "/events",
    "/events/new",
    `/events/${event.id}`,
    `/events/${event.id}/live`,
    `/events/${event.id}/report`,
    "/reports",
    "/audit",
    "/settings/team",
    "/settings/integrations",
  ]) {
    await expectNoViolations(page, path);
  }
});
