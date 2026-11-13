import { expect, type Page, test } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
}

test("an Owner signs up, invites a colleague, and the colleague joins and signs in", async ({
  page,
}) => {
  const violations = watchCsp(page);
  const ownerEmail = `owner-${unique()}@example.com`;
  const colleagueEmail = `colleague-${unique()}@example.com`;

  // Sign up: the new Owner lands on the team page of their own workspace.
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email address").fill(ownerEmail);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
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
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await page.context().clearCookies();

  await page.goto("/settings/team");

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%2Fteam/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings\/team$/);
});
