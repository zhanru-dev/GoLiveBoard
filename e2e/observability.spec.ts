import { openEvent } from "./api.js";
import { expect, SIGNED_IN_MS, test } from "./fixtures.js";
import { E2E_TARGET, target } from "./target.js";

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

  test("Grafana has the overview dashboard and the seven alert rules", async () => {
    const dashboards = (await (
      await fetch(`${GRAFANA}/api/search?query=OpsPilot%20overview`)
    ).json()) as { uid: string }[];
    const rules = (await (
      await fetch(`${GRAFANA}/api/v1/provisioning/alert-rules`)
    ).json()) as { uid: string }[];

    expect(dashboards.map(({ uid }) => uid)).toContain("opspilot-overview");
    expect(rules.map(({ uid }) => uid).sort()).toEqual([
      "opspilot-api-5xx",
      "opspilot-browser-realtime-failing",
      "opspilot-public-page-slow",
      "opspilot-queue-age",
      "opspilot-readiness",
      "opspilot-webhook-endpoint-failing",
      "opspilot-worker-silent",
    ]);
  });

  test("every alert rule evaluates, and every dashboard query runs", async () => {
    // Each rule has been evaluated since this test started, without an
    // error: an evaluation from before (a stack reused across changes)
    // proves nothing about the rules provisioned now. Rules are evaluated
    // every 30 seconds, so this waits up to that long and more.
    test.setTimeout(150_000);
    const started = Date.now();
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
              Date.parse(lastEvaluation) < started
                ? "not evaluated since the test started"
                : health,
            );
        },
        { timeout: 90_000 },
      )
      .toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);

    const dashboard = (await (
      await fetch(`${GRAFANA}/api/dashboards/uid/opspilot-overview`)
    ).json()) as {
      dashboard: { panels: { targets?: { expr: string }[] }[] };
    };
    const queries = dashboard.dashboard.panels.flatMap(({ targets }) =>
      (targets ?? []).map(({ expr }) => expr),
    );
    // Twelve charts, each with one query.
    expect(queries).toHaveLength(12);
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

  test("each alert rule fires past its threshold, and only then", async () => {
    // Grafana evaluates each provisioned rule with its query replaced by a
    // constant, on either side of the threshold: a threshold that can never
    // be crossed, or one on the wrong side, fails here. The real queries are
    // checked above.
    const cases: Record<string, { breach: string; normal: string }> = {
      "opspilot-api-5xx": { breach: "vector(0.03)", normal: "vector(0.02)" },
      "opspilot-readiness": { breach: "vector(0)", normal: "vector(1)" },
      "opspilot-queue-age": { breach: "vector(301)", normal: "vector(300)" },
      // absent() gives 1 when the worker is silent, nothing otherwise.
      "opspilot-worker-silent": {
        breach: "vector(1)",
        normal: "absent(vector(1))",
      },
      "opspilot-webhook-endpoint-failing": {
        breach: "vector(11)",
        normal: "vector(10)",
      },
      "opspilot-public-page-slow": {
        breach: "vector(2501)",
        normal: "vector(2500)",
      },
      "opspilot-browser-realtime-failing": {
        breach: "vector(11)",
        normal: "vector(10)",
      },
    };
    interface Rule {
      condition: string;
      data: { refId: string; model: { expr?: string } }[];
    }
    const fires = async (uid: string, expr: string) => {
      const rule = (await (
        await fetch(`${GRAFANA}/api/v1/provisioning/alert-rules/${uid}`)
      ).json()) as Rule;
      const data = rule.data.map((query) =>
        query.model.expr === undefined
          ? query
          : { ...query, model: { ...query.model, expr } },
      );
      const response = await fetch(`${GRAFANA}/api/v1/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, condition: rule.condition }),
      });
      expect(response.status, uid).toBe(200);
      const body = (await response.json()) as {
        results: Record<
          string,
          { frames?: { data: { values: (number | null)[][] } }[] }
        >;
      };
      return (body.results[rule.condition]?.frames ?? []).some(({ data }) =>
        data.values.some((values) => values.includes(1)),
      );
    };

    for (const [uid, { breach, normal }] of Object.entries(cases)) {
      expect(await fires(uid, breach), `${uid} at ${breach}`).toBe(true);
      expect(await fires(uid, normal), `${uid} at ${normal}`).toBe(false);
    }
  });

  test("the web server records a page request whose traceparent says not to (-00)", async ({
    request,
  }) => {
    // A visitor's request may name a parent and ask not to be recorded; the
    // web server records it all the same (ADR-0011, tracePolicy()).
    test.setTimeout(90_000);
    const traceId = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
    const response = await request.get("/sign-in", {
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-00` },
    });
    expect(response.status()).toBe(200);

    await expect
      .poll(() => servicesOf(traceId), { timeout: 60_000 })
      .toContain("opspilot-web");
  });

  test("Worker not reporting watches a metric only the worker sends", async () => {
    // The rule's whole point is the worker's silence: a metric another
    // process also sends would never go absent while that process runs.
    test.setTimeout(90_000);
    const rule = (await (
      await fetch(
        `${GRAFANA}/api/v1/provisioning/alert-rules/opspilot-worker-silent`,
      )
    ).json()) as { data: { model: { expr?: string } }[] };
    const expr = rule.data.find(({ model }) => model.expr)?.model.expr ?? "";
    const metric = /^absent\(([a-z_]+)\)$/.exec(expr)?.[1];
    expect(metric, expr).toBeDefined();

    await expect
      .poll(
        async () => {
          const body = (await (
            await fetch(
              `${GRAFANA}/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(`count by (service_name) (${metric ?? ""})`)}`,
            )
          ).json()) as {
            data: { result: { metric: { service_name: string } }[] };
          };
          return body.data.result.map(({ metric }) => metric.service_name);
        },
        { timeout: 60_000 },
      )
      .toEqual(["opspilot-worker"]);
  });

  test("the API's log lines reach Loki, in their trace and without personal data", async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const traceId = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
    const email = `logged-${unique()}@example.com`;
    const response = await request.post("/api/v1/auth/sign-in", {
      headers: {
        origin: new URL(target.baseURL).origin,
        traceparent: `00-${traceId}-b7ad6b7169203331-01`,
      },
      data: { email, password: "not the right password at all" },
    });
    expect(response.status()).toBe(401);

    // The line is the message; the rest of the record (trace_id, request
    // fields) is structured metadata, filtered with "|".
    const query = `{service_name="opspilot-api"} | trace_id="${traceId}"`;
    const lines = async () => {
      const url = new URL(
        `${GRAFANA}/api/datasources/proxy/uid/loki/loki/api/v1/query_range`,
      );
      url.searchParams.set("query", query);
      url.searchParams.set("since", "10m");
      const body = (await (await fetch(url)).json()) as {
        data?: {
          result?: {
            stream: Record<string, string>;
            values: [string, string][];
          }[];
        };
      };
      // Each entry with everything Loki holds about it.
      return (body.data?.result ?? []).flatMap(({ stream, values }) =>
        values.map(([, line]) => `${line} ${JSON.stringify(stream)}`),
      );
    };
    await expect.poll(lines, { timeout: 60_000 }).not.toEqual([]);
    const found = (await lines()).join("\n");
    expect(found).toContain("request completed");
    expect(found).not.toContain(email);
    expect(found).not.toContain("not the right password");
  });

  test("a real visit's Web Vitals reach Prometheus, by route template", async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const query = `sum(opspilot_web_vital_duration_milliseconds_count{opspilot_web_vital="LCP",opspilot_web_route="/e/:slug"})`;
    const count = async () => {
      const body = (await (
        await fetch(
          `${GRAFANA}/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(query)}`,
        )
      ).json()) as { data: { result: { value: [number, string] }[] } };
      return Number(body.data.result[0]?.value[1] ?? "0");
    };
    const before = await count();
    const event = await openEvent(request);

    // A visitor opens the public page, and leaves: the beacon goes out as
    // the page is hidden.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`/e/${event.slug}`);
    await page.getByLabel("Name").click();
    await page.close({ runBeforeUnload: true });
    await context.close();

    await expect.poll(count, { timeout: 60_000 }).toBeGreaterThan(before);
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
