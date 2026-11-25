import { openEvent, PASSWORD } from "./api.js";
import { expect, test } from "./fixtures.js";

/**
 * What a scanner found (docs/security-review.md): without the page's
 * script (slow network, script blocked), a form falls back to the
 * browser's own submission. It must post, never put its fields in the URL,
 * where proxies, logs and history keep them.
 */
test.describe("forms without the page's script", () => {
  test.use({ javaScriptEnabled: false });

  test("post their fields instead of putting them in the URL", async ({
    page,
    browser,
  }) => {
    const event = await openEvent((await browser.newContext()).request);
    const forms: {
      path: string;
      fields: [label: string | RegExp, value: string][];
      submit: string;
    }[] = [
      {
        path: "/sign-in",
        fields: [
          ["Email address", "ada@example.com"],
          ["Password", PASSWORD],
        ],
        submit: "Sign in",
      },
      {
        path: "/sign-up",
        fields: [
          ["Your name", "Ada Lovelace"],
          ["Email address", "ada@example.com"],
          ["Password", PASSWORD],
        ],
        submit: "Create account",
      },
      {
        path: "/forgot-password",
        fields: [["Email address", "ada@example.com"]],
        submit: "Email me a reset link",
      },
      {
        path: `/e/${event.slug}`,
        fields: [
          ["Name", "Ada Lovelace"],
          ["Email address", "ada@example.com"],
        ],
        submit: "Register",
      },
    ];
    for (const form of forms) {
      await page.goto(form.path);
      for (const [label, value] of form.fields) {
        await page.getByLabel(label, { exact: true }).fill(value);
      }
      const sent = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.method() !== "GET",
      );
      await page.getByRole("button", { name: form.submit }).click();

      const request = await sent;
      expect(request.method(), form.path).toBe("POST");
      expect(request.url(), form.path).not.toContain("ada%40example.com");
      expect(request.url(), form.path).not.toContain("horse");
    }
  });
});

test("pages keep other sites' windows and pages away (COOP, CORP)", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");

  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["cross-origin-resource-policy"]).toBe(
    "same-origin",
  );
});

test("refuses the methods no page or API uses, at the proxy (F4)", async ({
  request,
}) => {
  for (const path of ["/sign-in", "/api/v1/health/live"]) {
    for (const method of ["TRACE", "TRACK"]) {
      const response = await request.fetch(path, { method });
      expect(response.status(), `${method} ${path}`).toBe(405);
    }
  }
});
