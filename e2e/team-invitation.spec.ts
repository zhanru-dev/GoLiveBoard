import type { Page } from "@playwright/test";

import { expect, SIGNED_IN_MS, test } from "./fixtures.js";

import { latestEmailTo, linkIn } from "./mailpit.js";

const PASSWORD = "correct horse battery staple";
const unique = () =>
  `${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Fails the test if the page reports a Content Security Policy violation. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Content Security Policy")
    ) {
      violations.push(message.text());
    }
  });
  return violations;
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
}

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
}

async function switchWorkspace(page: Page, name: string) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
  ).toHaveText(name);
}

test("an Owner signs up, invites a colleague, and the colleague joins and signs in", async ({
  page,
}) => {
  const violations = watchCsp(page);
  const ownerEmail = `owner-${unique()}@example.com`;
  const colleagueEmail = `colleague-${unique()}@example.com`;

  // Sign up: the new Owner lands on the team page of their own workspace.
  await signUp(page, "Ada Lovelace", ownerEmail);
  await expect(page.getByRole("cell", { name: ownerEmail })).toBeVisible();

  // Invite a colleague as an Analyst (the default role).
  await page.getByLabel("Email address").fill(colleagueEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("cell", { name: colleagueEmail })).toBeVisible();

  // The colleague follows the link in the email and creates an account.
  const invitation = await latestEmailTo(colleagueEmail);
  await page.context().clearCookies();
  await page.goto(linkIn(invitation));
  await expect(page.getByText("as Analyst")).toBeVisible();
  await page.getByLabel("Your name").fill("Grace Hopper");
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByText("You have joined")).toBeVisible();

  // And signs in to the shared workspace, as an Analyst without admin tools.
  await signIn(page, colleagueEmail);
  await expect(page.getByRole("cell", { name: ownerEmail })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toHaveCount(0);

  expect(violations).toEqual([]);
});

test("a signed-out visitor is sent to sign in and brought back afterwards", async ({
  page,
}) => {
  const email = `returning-${unique()}@example.com`;
  await signUp(page, "Ada Lovelace", email);
  await page.context().clearCookies();

  await page.goto("/settings/team");

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%2Fteam/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings\/team$/);
});

test("a member of two workspaces sees each one's own team after switching", async ({
  page,
}) => {
  const violations = watchCsp(page);
  const adaEmail = `ada-${unique()}@example.com`;
  const charlesEmail = `charles-${unique()}@example.com`;

  // Ada and Charles each own a workspace; Charles invites Ada into his.
  await signUp(page, "Ada Lovelace", adaEmail);
  await page.context().clearCookies();
  await signUp(page, "Charles Babbage", charlesEmail);
  await page.getByLabel("Email address").fill(adaEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("cell", { name: adaEmail })).toBeVisible();
  const invitation = await latestEmailTo(adaEmail);
  await page.context().clearCookies();
  await page.goto(linkIn(invitation));
  await page.getByRole("button", { name: "Join workspace" }).click();
  await expect(page.getByText("You have joined")).toBeVisible();

  // Ada starts in her own workspace, where Charles is not a member.
  await signIn(page, adaEmail);
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
  ).toHaveText("Ada Lovelace's workspace");
  await expect(page.getByRole("cell", { name: adaEmail })).toBeVisible();
  await expect(page.getByRole("cell", { name: charlesEmail })).toHaveCount(0);

  // In Charles's workspace she sees his team, as an Analyst.
  await switchWorkspace(page, "Charles Babbage's workspace");
  await expect(page.getByRole("cell", { name: charlesEmail })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toHaveCount(0);

  // And back in her own, nothing of Charles's workspace remains.
  await switchWorkspace(page, "Ada Lovelace's workspace");
  await expect(page.getByRole("cell", { name: adaEmail })).toBeVisible();
  await expect(page.getByRole("cell", { name: charlesEmail })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeVisible();

  expect(violations).toEqual([]);
});

// Each of these resolves to `//redirect.invalid` somewhere between the
// address bar and the router: a backslash, a tab, and dot segments (plain
// and percent-encoded) that collapse into a double slash.
test.describe("a crafted next parameter", () => {
  // One account for every case: sign-ups are limited per address, and the
  // whole suite comes from one.
  const email = `redirect-${unique()}@example.com`;

  test.beforeAll(async ({ request, baseURL }) => {
    const response = await request.post("/api/v1/auth/sign-up", {
      headers: { Origin: new URL(baseURL ?? "").origin },
      data: { name: "Ada Lovelace", email, password: PASSWORD },
    });
    expect(response.status()).toBe(202);
  });

  for (const next of [
    "/\\redirect.invalid",
    "/\t/redirect.invalid",
    "/.//redirect.invalid",
    "/%2e//redirect.invalid",
  ]) {
    test(`cannot send the user to another site: ${JSON.stringify(next)}`, async ({
      page,
      baseURL,
    }) => {
      // Never let the browser actually leave, whatever happens.
      await page.route("**://redirect.invalid/**", (route) => route.abort());

      await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();

      await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
        timeout: SIGNED_IN_MS,
      });
      expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? "").origin);
      expect(new URL(page.url()).pathname).toBe("/events");
    });
  }
});
