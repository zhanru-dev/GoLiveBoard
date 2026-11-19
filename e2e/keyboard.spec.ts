/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";

import { PASSWORD, unique } from "./api.js";
import { expect, SIGNED_IN_MS, test } from "./fixtures.js";
import { latestEmailTo, linkIn } from "./mailpit.js";
import { resetRateLimits } from "./rate-limits.js";

/** A 1×1 PNG, as the holding slate. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * What has focus, and whether it shows (WCAG 2.4.7): an outline, or a
 * shadow (the design's focus ring) that is opaque and has some size. Read
 * once the browser has drawn the focus style, transitions finished.
 */
async function focused(page: Page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) {
      return { name: "(page)", shown: true };
    }
    for (const animation of element.getAnimations()) {
      animation.finish();
    }
    const label =
      element.getAttribute("aria-label") ??
      element.textContent.trim().slice(0, 40);
    const name = `${element.tagName.toLowerCase()} "${label}"`;
    // Focus on the calendar button inside a date field: the browser draws
    // its ring there, out of the page's styles (checked by eye).
    if (
      element instanceof HTMLInputElement &&
      element.type.startsWith("date") &&
      !element.matches(":focus-visible")
    ) {
      return { name, shown: true };
    }
    const style = getComputedStyle(element);
    const outline =
      style.outlineStyle !== "none" &&
      Number.parseFloat(style.outlineWidth) > 0;
    // Each shadow: a colour, then lengths; visible if not fully transparent
    // and not zero in size.
    const ring = style.boxShadow.split(/,(?![^(]*\))/).some((shadow) => {
      const transparent = /rgba\([^)]*,\s*0\)|transparent|\/\s*0\)/.test(
        shadow,
      );
      const lengths = shadow.match(/-?[\d.]+px/g) ?? [];
      return !transparent && lengths.some((length) => length !== "0px");
    });
    return { name, shown: outline || ring };
  });
}

/**
 * Presses Tab until `target` has focus, as a keyboard user would. Every
 * stop on the way must show where focus is (2.4.7), focus must keep
 * moving (no trap, 2.1.2), and the target must be reachable (2.1.1).
 */
async function tabTo(page: Page, target: Locator, most = 150) {
  const hidden: string[] = [];
  for (let stop = 0; stop < most; stop += 1) {
    await page.keyboard.press("Tab");
    const now = await focused(page);
    if (!now.shown) {
      hidden.push(now.name);
    }
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      expect(hidden, "tab stops without a visible focus indicator").toEqual([]);
      return;
    }
  }
  throw new Error(`Not reached by keyboard within ${String(most)} tab stops`);
}

/** Focuses `target` by keyboard and types into it. */
async function typeInto(page: Page, target: Locator, text: string) {
  await tabTo(page, target);
  await page.keyboard.type(text);
}

/**
 * NFR-6: the golden flow by keyboard alone (docs/01, section 3). No click,
 * no fill: every control is reached with Tab and used with Enter, Space or
 * typing, as someone who cannot use a pointer would.
 */
test("the golden flow works by keyboard alone, with focus always visible (NFR-6)", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  // 1 · Prepare: a Manager signs up and prepares an event.
  await page.goto("/sign-up");
  await typeInto(page, page.getByLabel("Your name"), "Ada Lovelace");
  await typeInto(
    page,
    page.getByLabel("Email address"),
    `keyboard-${unique()}@example.com`,
  );
  await typeInto(page, page.getByLabel("Password"), PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });
  // The first stop skips the header (2.4.1).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  expect((await focused(page)).shown).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await tabTo(page, page.getByRole("link", { name: "New event" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "New event" })).toBeVisible();
  await typeInto(
    page,
    page.getByLabel("Title", { exact: true }),
    "Keyboard launch",
  );
  await typeInto(page, page.getByLabel("Description"), "Run without a mouse.");
  await tabTo(page, page.getByRole("button", { name: "Create event" }));
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Keyboard launch" }),
  ).toBeVisible();
  const eventPath = new URL(page.url()).pathname;

  await tabTo(page, page.getByRole("button", { name: "Start configuring" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Mark ready" })).toBeVisible();
  await typeInto(page, page.getByLabel("Privacy notice version"), "2026-11");
  await tabTo(page, page.getByRole("button", { name: "Set access policy" }));
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Access policy set: anyone can register."),
  ).toBeVisible();

  // The file picker opens from the keyboard too.
  const upload = page.getByLabel("Upload an image");
  await tabTo(page, upload);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Space");
  await (
    await chooser
  ).setFiles({
    name: "slate.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(
    page.getByRole("img", { name: "Current holding slate" }),
  ).toBeVisible({ timeout: 15_000 });

  // Questions wait for a moderator.
  const approval = page.getByRole("checkbox", { name: /wait for approval/ });
  await tabTo(page, approval);
  await page.keyboard.press("Space");
  await expect(approval).toBeChecked();
  const slug = await page.evaluate(async (path) => {
    const id = path.split("/").pop() ?? "";
    const response = await fetch(`/api/v1/events/${id}`);
    return ((await response.json()) as { slug: string }).slug;
  }, eventPath);

  // 2 · Admit: a visitor registers on the public page and confirms.
  const context = await browser.newContext();
  const visitor = await context.newPage();
  resetRateLimits();
  await visitor.goto(`/e/${slug}`);
  const email = `keyboard-attendee-${unique()}@example.com`;
  await typeInto(visitor, visitor.getByLabel("Name"), "Grace Hopper");
  await typeInto(visitor, visitor.getByLabel("Email address"), email);
  // The privacy notice opens and closes from the keyboard.
  const notice = visitor.getByText("Privacy notice (version 2026-11)");
  await tabTo(visitor, notice);
  await visitor.keyboard.press("Enter");
  await expect(
    visitor.getByText(/deleted or anonymised 90 days/),
  ).toBeVisible();
  const consent = visitor.getByLabel(/agree to it/);
  await tabTo(visitor, consent);
  await visitor.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await tabTo(visitor, visitor.getByRole("button", { name: "Register" }));
  await visitor.keyboard.press("Enter");
  await expect(visitor.getByRole("status")).toContainText("Check your inbox");
  // The link in the email: opening it is not a keyboard question.
  await visitor.goto(linkIn(await latestEmailTo(email)));
  await expect(visitor.getByRole("status")).toContainText(
    "You are registered as Grace Hopper",
  );

  // 3 · Run: the attendee chats and asks; the moderator approves.
  await tabTo(visitor, visitor.getByRole("link", { name: /Go to the event/ }));
  await visitor.keyboard.press("Enter");
  await expect(
    visitor.getByText("Live: chat and questions update as they happen."),
  ).toBeVisible();
  await typeInto(
    visitor,
    visitor.getByLabel("Your message"),
    "Hello by keyboard",
  );
  await visitor.keyboard.press("Enter");
  await expect(
    visitor
      .getByRole("log", { name: "Chat messages" })
      .getByText("Hello by keyboard"),
  ).toBeVisible();
  await typeInto(
    visitor,
    visitor.getByLabel("Your question"),
    "Is there a recording?",
  );
  await tabTo(visitor, visitor.getByRole("button", { name: "Ask" }));
  await visitor.keyboard.press("Enter");
  await expect(
    visitor.getByText("Waiting for a moderator · Yours"),
  ).toBeVisible();

  const approve = page.getByRole("button", {
    name: "Approve: Is there a recording?",
  });
  await expect(approve).toBeVisible();
  await tabTo(page, approve);
  await page.keyboard.press("Enter");
  await expect(
    visitor.getByText("Waiting for a moderator · Yours"),
  ).toHaveCount(0);
  await context.close();
});
