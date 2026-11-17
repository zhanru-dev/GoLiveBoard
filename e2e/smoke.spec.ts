import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { expect, SIGNED_IN_MS, test } from "./fixtures.js";

import { E2E_TARGET, target } from "./target.js";

/**
 * Smoke tests of the production-like stack: the production images behind
 * Caddy over HTTPS (docker-compose.prod.yml). They check what only that
 * stack can show; the other browser tests check the product itself and run
 * against it too.
 */
test.skip(E2E_TARGET !== "stack", "Checks the production-like stack only");

const PASSWORD = "correct horse battery staple";
const site = new URL(target.baseURL);

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/**
 * Requests a path from the proxy on 127.0.0.1 with the site's host name, so
 * the test does not depend on the machine resolving *.localhost.
 */
function rawRequest(
  url: URL,
  options: { readonly ca?: string } = {},
): Promise<RawResponse> {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(
      {
        host: "127.0.0.1",
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host },
        // TLS: the name the certificate must carry, and the one authority
        // that may have signed it.
        servername: url.hostname,
        ca: options.ca,
        rejectUnauthorized: true,
        timeout: 5000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          });
        });
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("Timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The root certificate of Caddy's local authority, from the proxy. */
function stackAuthority(): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "--file",
      target.composeFile,
      "exec",
      "-T",
      "proxy",
      "cat",
      "/data/caddy/pki/authorities/local/root.crt",
    ],
    { encoding: "utf8" },
  );
}

test("serves the site over HTTPS with a certificate for its name", async () => {
  const ready = await rawRequest(new URL("/api/v1/health/ready", site), {
    ca: stackAuthority(),
  });

  expect(ready.status).toBe(200);
  expect(JSON.parse(ready.body)).toMatchObject({ status: "ok" });
  expect(ready.headers["strict-transport-security"]).toBe(
    "max-age=31536000; includeSubDomains",
  );
});

test("refuses a certificate check against any other authority", async () => {
  // Without the stack's authority, Node's own trust store must reject the
  // certificate: the check above is not passing by accident.
  await expect(
    rawRequest(new URL("/api/v1/health/live", site)),
  ).rejects.toThrow(/certificate/i);
});

test("redirects plain HTTP to HTTPS, keeping the path and query", async () => {
  const plain = new URL(site);
  plain.protocol = "http:";
  plain.port = process.env.STACK_HTTP_PORT ?? "3380";
  plain.pathname = "/sign-in";
  plain.search = "?next=%2Fevents";

  const response = await rawRequest(plain);

  expect(response.status).toBe(301);
  expect(response.headers.location).toBe(
    new URL("/sign-in?next=%2Fevents", site).href,
  );
});

test("keeps a new session in secure, HTTP-only cookies", async ({
  page,
  context,
}) => {
  const email = `smoke-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@example.com`;

  const signUpPage = await page.goto("/sign-up");
  expect(signUpPage?.headers()["strict-transport-security"]).toBeDefined();
  expect(signUpPage?.headers()["content-security-policy"]).toContain(
    "'strict-dynamic'",
  );
  await page.getByLabel("Your name").fill("Smoke Test");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });

  const cookies = await context.cookies();
  expect(
    cookies.map(({ name, path, secure, httpOnly, sameSite, domain }) => ({
      name,
      path,
      secure,
      httpOnly,
      sameSite,
      domain,
    })),
  ).toEqual(
    expect.arrayContaining([
      {
        name: "__Host-opspilot_access",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
        domain: site.hostname,
      },
      {
        name: "__Secure-opspilot_refresh",
        path: "/api/v1/auth",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
        domain: site.hostname,
      },
    ]),
  );

  // The session survives a full reload, served again by the web image.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });
});

test("reports a browser error to Sentry, without the page's secrets", async ({
  page,
}) => {
  // The stack's DSN names sentry.invalid, which never resolves; the test
  // receives what the page sends there. The Content Security Policy must
  // allow it first, so this also checks the policy.
  const envelopes: string[] = [];
  await page.route("https://sentry.invalid/**", async (route) => {
    envelopes.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, body: "{}" });
  });
  await page.goto("/sign-in?next=%2Fevents#token=one-time-secret");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("Smoke test: an error in the browser");
    });
  });

  await expect
    .poll(() =>
      envelopes.find((envelope) =>
        envelope.includes("Smoke test: an error in the browser"),
      ),
    )
    .toBeDefined();
  const envelope =
    envelopes.find((sent) =>
      sent.includes("Smoke test: an error in the browser"),
    ) ?? "";
  expect(envelope).toContain('"process":"browser"');
  expect(envelope).toContain('"environment":"stack"');
  expect(envelope).toContain(new URL("/sign-in", site).href);
  expect(envelope).not.toContain("one-time-secret");
  expect(envelope).not.toContain("next=");
});

test("a visitor signs in to the demo with one click", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByRole("button", { name: "Try the demo" }).click();

  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });
  await expect(page.getByRole("note")).toContainText("shared demo workspace");
  await expect(
    page.getByRole("button", { name: "Switch workspace" }),
  ).toHaveText("Northwind Events (demo)");
  await expect(
    page.getByRole("link", { name: "Autumn product launch" }),
  ).toBeVisible();
});

test("a demo visitor registers for a demo event and confirms from the demo inbox", async ({
  page,
  browser,
}) => {
  // The demo's Manager opens the seeded event, which is open for
  // registration, and follows its public page link.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("link", { name: "Autumn product launch" }).click();
  const audience = page.getByRole("region", { name: "Audience" });
  const publicPath =
    (await audience.getByRole("link", { name: /^\/e\// }).textContent()) ?? "";

  // Anyone can register, from any address: nothing is sent, the mail is in
  // this browser's demo inbox.
  const attendee = await browser.newContext();
  const visitor = await attendee.newPage();
  await visitor.goto(publicPath);
  await visitor.getByLabel("Name").fill("Demo Attendee");
  // The seeded event admits addresses at northwind.example only, as its
  // page says; any other address would get nothing, and be told nothing.
  await expect(
    visitor.getByText("Open to addresses at northwind.example."),
  ).toBeVisible();
  await visitor
    .getByLabel("Email address")
    .fill(`visitor-${String(Date.now())}@northwind.example`);
  await visitor.getByLabel(/agree to it/).check();
  await visitor.getByRole("button", { name: "Register" }).click();
  await visitor.getByRole("link", { name: "Open the demo inbox" }).click();
  const message = visitor.getByRole("article", {
    name: "Confirm your registration for Autumn product launch",
  });
  await message.getByRole("link").click();

  await expect(visitor.getByRole("status")).toContainText(
    "You are registered as Demo Attendee",
  );
  await attendee.close();
});
