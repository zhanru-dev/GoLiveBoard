/// <reference lib="dom" />
import type { Page } from "@playwright/test";

import { call, openEvent, unique } from "./api.js";
import { expect, test } from "./fixtures.js";
import { latestEmailTo, linkIn } from "./mailpit.js";

/**
 * Two WCAG 2.2 AA criteria axe does not check:
 * - **1.4.10 Reflow:** at 320 CSS pixels wide (a 1280 px screen zoomed to
 *   400%), nothing scrolls sideways except content that needs two
 *   dimensions (tables keep their own scroll region).
 * - **2.5.8 Target Size (Minimum):** every target is at least 24 × 24 CSS
 *   pixels, or the 24 px circle around it touches no other target or
 *   circle. Links inside a sentence, and controls the browser sizes itself,
 *   are exempt.
 */
async function layoutProblems(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      problems.push(
        `scrolls sideways: ${String(root.scrollWidth)} px in ${String(root.clientWidth)} px`,
      );
    }
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 40)}"`;
    const targets = [...document.querySelectorAll(selector)]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const exempt = (element: HTMLElement) => {
      // A link in a sentence: its size is the text's.
      if (
        element.tagName === "A" &&
        getComputedStyle(element).display === "inline"
      ) {
        return true;
      }
      // A checkbox or radio button as the browser draws it.
      return (
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio") &&
        getComputedStyle(element).appearance !== "none"
      );
    };
    const small = targets.filter(
      ({ element, box }) =>
        (box.width < 24 || box.height < 24) && !exempt(element),
    );
    const centre = (box: DOMRect) => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    });
    // The distance from a point to a rectangle (0 inside it).
    const distance = (point: { x: number; y: number }, box: DOMRect) =>
      Math.hypot(
        Math.max(box.left - point.x, 0, point.x - box.right),
        Math.max(box.top - point.y, 0, point.y - box.bottom),
      );
    for (const { element, box } of small) {
      const here = centre(box);
      const crowded =
        targets.some(
          (other) =>
            other.element !== element &&
            !other.element.contains(element) &&
            !element.contains(other.element) &&
            distance(here, other.box) < 12,
        ) ||
        small.some(
          (other) =>
            other.element !== element &&
            Math.hypot(
              here.x - centre(other.box).x,
              here.y - centre(other.box).y,
            ) < 24,
        );
      if (crowded) {
        problems.push(
          `target ${describe(element)} is ${String(Math.round(box.width))} × ${String(Math.round(box.height))} px, too close to another`,
        );
      }
    }
    return problems;
  });
}

test.describe("reflow and target size at 320 CSS pixels (NFR-6)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("pages without a session", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const event = await openEvent(page.request);
    const visitor = await (
      await browser.newContext({
        viewport: { width: 320, height: 640 },
      })
    ).newPage();
    const found: Record<string, string[]> = {};
    for (const path of [
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      `/e/${event.slug}`,
    ]) {
      const problems = await layoutProblems(visitor, path);
      if (problems.length > 0) {
        found[path] = problems;
      }
    }

    expect(found).toEqual({});
  });

  test("pages of the signed-in app", async ({ page }) => {
    test.setTimeout(90_000);
    const event = await openEvent(page.request);
    // Invitation-only: Launch Control then shows its invitation form too.
    const invited = (await (
      await call(page.request, "post", "/events", {
        title: `Invitation only ${unique()}`,
        description: "By invitation.",
        startsAt: "2027-03-01T18:00:00Z",
        endsAt: "2027-03-01T19:00:00Z",
        timeZone: "Europe/London",
      })
    ).json()) as { id: string };
    await call(page.request, "put", `/events/${invited.id}/access-policy`, {
      mode: "INVITE_ONLY",
      allowedDomains: [],
      privacyNoticeVersion: "2026-11",
    });
    const found: Record<string, string[]> = {};
    for (const path of [
      "/events",
      "/events/new",
      `/events/${event.id}`,
      `/events/${invited.id}`,
      `/events/${event.id}/live`,
      `/events/${event.id}/report`,
      "/audit",
      "/settings/team",
      "/settings/integrations",
    ]) {
      const problems = await layoutProblems(page, path);
      if (problems.length > 0) {
        found[path] = problems;
      }
    }

    expect(found).toEqual({});
  });

  test("the watch page, for an attendee", async ({ page, browser }) => {
    const event = await openEvent(page.request);
    const visitor = await (
      await browser.newContext({ viewport: { width: 320, height: 640 } })
    ).newPage();
    const email = `narrow-${unique()}@example.com`;
    await visitor.goto(`/e/${event.slug}`);
    await visitor.getByLabel("Name").fill("Grace Hopper");
    await visitor.getByLabel("Email address").fill(email);
    await visitor.getByLabel(/agree to it/).check();
    await visitor.getByRole("button", { name: "Register" }).click();
    await expect(visitor.getByRole("status")).toContainText("Check your inbox");
    await visitor.goto(linkIn(await latestEmailTo(email)));
    await expect(visitor.getByRole("status")).toContainText(
      "You are registered as Grace Hopper",
    );

    expect(await layoutProblems(visitor, `/e/${event.slug}/watch`)).toEqual([]);
  });
});
