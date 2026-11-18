import { expect, SIGNED_IN_MS, test } from "./fixtures.js";
import { E2E_TARGET } from "./target.js";

/** The stack's Grafana (docs/06, section 7); no sign-in, local only. */
const GRAFANA = `http://127.0.0.1:${process.env.STACK_GRAFANA_PORT ?? "3037"}`;
const TEMPO = `${GRAFANA}/api/datasources/proxy/uid/tempo`;

const PASSWORD = "correct horse battery staple";
const unique = () =>
  `${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** The services a trace's spans came from, once Tempo has them all. */
async function servicesOf(traceId: string): Promise<string[]> {
  const response = await fetch(`${TEMPO}/api/traces/${traceId}`);
  if (!response.ok) {
    return [];
  }
  const trace = (await response.json()) as {
    batches?: {
      resource: {
        attributes: { key: string; value: { stringValue?: string } }[];
      };
    }[];
  };
  return [
    ...new Set(
      (trace.batches ?? []).flatMap(({ resource }) =>
        resource.attributes
          .filter(({ key }) => key === "service.name")
          .map(({ value }) => value.stringValue ?? ""),
      ),
    ),
  ].sort();
}

test.describe("observability (NFR-7, docs/06 section 7)", () => {
  test.skip(E2E_TARGET !== "stack", "Grafana runs in the stack only");

  test("Grafana has the overview dashboard and the four alert rules", async () => {
    const dashboards = (await (
      await fetch(`${GRAFANA}/api/search?query=OpsPilot%20overview`)
    ).json()) as { uid: string }[];
    const rules = (await (
      await fetch(`${GRAFANA}/api/v1/provisioning/alert-rules`)
    ).json()) as { uid: string }[];

    expect(dashboards.map(({ uid }) => uid)).toContain("opspilot-overview");
    expect(rules.map(({ uid }) => uid).sort()).toEqual([
      "opspilot-api-5xx",
      "opspilot-queue-age",
      "opspilot-readiness",
      "opspilot-webhook-endpoint-failing",
    ]);
  });

  test("every alert rule evaluates, and every dashboard query runs", async () => {
    // Each rule has been evaluated at least once, without an error.
    await expect
      .poll(
        async () => {
          const body = (await (
            await fetch(`${GRAFANA}/api/prometheus/grafana/api/v1/rules`)
          ).json()) as {
            data: {
              groups: {
                rules: { health: string; lastEvaluation: string }[];
              }[];
            };
          };
          // Grafana says "ok" before a rule's first evaluation too.
          return body.data.groups
            .flatMap(({ rules }) => rules)
            .map(({ health, lastEvaluation }) =>
              lastEvaluation.startsWith("0001") ? "not evaluated yet" : health,
            );
        },
        { timeout: 90_000 },
      )
      .toEqual(["ok", "ok", "ok", "ok"]);

    const dashboard = (await (
      await fetch(`${GRAFANA}/api/dashboards/uid/opspilot-overview`)
    ).json()) as {
      dashboard: { panels: { targets?: { expr: string }[] }[] };
    };
    const queries = dashboard.dashboard.panels.flatMap(({ targets }) =>
      (targets ?? []).map(({ expr }) => expr),
    );
    // Nine charts, each with one query.
    expect(queries).toHaveLength(9);
    // The collector checks the API's readiness (the readiness alert's
    // source): the stack is healthy, so the latest check passed.
    const readiness = queries.find((query) => query.includes("httpcheck"));
    await expect
      .poll(
        async () => {
          const body = (await (
            await fetch(
              `${GRAFANA}/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(readiness ?? "")}`,
            )
          ).json()) as { data: { result: { value: [number, string] }[] } };
          return body.data.result[0]?.value[1];
        },
        { timeout: 60_000 },
      )
      .toBe("1");
    for (const query of queries) {
      const result = await fetch(
        `${GRAFANA}/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(query)}`,
      );
      expect(result.status, query).toBe(200);
    }
  });

  test("one trace follows a click from the browser through the API to the worker", async ({
    page,
  }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("Ada Lovelace");
    await page
      .getByLabel("Email address")
      .fill(`traced-${unique()}@example.com`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
      timeout: SIGNED_IN_MS,
    });
    await page.getByRole("link", { name: "New event" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Traced launch");
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(
      page.getByRole("heading", { name: "Traced launch" }),
    ).toBeVisible();

    // The transition writes an outbox message; the worker runs its job.
    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/transitions"),
    );
    await page.getByRole("button", { name: "Start configuring" }).click();
    const traceparent = (await sent).headers().traceparent ?? "";
    const [, traceId] = traceparent.split("-");
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    await expect
      .poll(() => servicesOf(traceId ?? ""), { timeout: 60_000 })
      .toEqual(["opspilot-api", "opspilot-worker"]);
  });
});
