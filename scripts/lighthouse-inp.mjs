// Interaction to Next Paint on the public event page (NFR-3), measured in
// the lab: a Lighthouse user flow loads the page as a mid-range phone on
// slow 4G (Lighthouse's default mobile emulation, CPU slowed 4 times), then
// fills in and submits the registration form, and reads the slowest
// interaction's INP. Run five times; the median must stay under 200 ms.
//
// LIGHTHOUSE_URL: the page. CHROME_PATH: the browser to drive.
// Writes .lighthouseci/inp.json; exits 1 when the budget is exceeded.

import { mkdirSync, writeFileSync } from "node:fs";

import { startFlow } from "lighthouse";
import puppeteer from "puppeteer-core";

const BUDGET_MS = 200;
const RUNS = 5;

const url = process.env.LIGHTHOUSE_URL;
const executablePath = process.env.CHROME_PATH;
if (!url || !executablePath) {
  throw new Error("Set LIGHTHOUSE_URL and CHROME_PATH");
}

async function measure() {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    acceptInsecureCerts: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const flow = await startFlow(page, {
      config: {
        extends: "lighthouse:default",
        settings: { onlyCategories: ["performance"] },
      },
    });
    await flow.navigate(url);
    await flow.startTimespan();
    await page.type('input[name="name"]', "Ada Lovelace");
    await page.type('input[name="email"]', "ada@example.com");
    await page.click('input[name="consent"]');
    await page.click('input[name="remindersOptIn"]');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="status"], [role="alert"]');
    await flow.endTimespan();
    const { steps } = await flow.createFlowResult();
    const lhr = steps[1]?.lhr;
    const audit = lhr?.audits["interaction-to-next-paint"];
    if (typeof audit?.numericValue !== "number") {
      throw new Error("The flow recorded no interaction");
    }
    // Evidence that the phone was emulated, not this machine's full speed.
    const { throttlingMethod, throttling, formFactor } = lhr.configSettings;
    if (
      throttlingMethod !== "devtools" ||
      throttling.cpuSlowdownMultiplier < 4 ||
      formFactor !== "mobile"
    ) {
      throw new Error(
        `Unexpected emulation: ${JSON.stringify({ throttlingMethod, throttling, formFactor })}`,
      );
    }
    return audit.numericValue;
  } finally {
    await browser.close();
  }
}

const runs = [];
for (let run = 0; run < RUNS; run += 1) {
  runs.push(await measure());
}
const median = [...runs].sort((a, b) => a - b)[Math.floor(RUNS / 2)];
const passed = median <= BUDGET_MS;
mkdirSync(".lighthouseci", { recursive: true });
writeFileSync(
  ".lighthouseci/inp.json",
  `${JSON.stringify({ url, runs, median, budget: BUDGET_MS, passed }, null, 2)}\n`,
);
process.stdout.write(
  `Interaction to Next Paint: median ${String(Math.round(median))} ms of ${runs
    .map((value) => Math.round(value))
    .join(", ")} (budget ${String(BUDGET_MS)} ms)\n`,
);
if (!passed) {
  process.exitCode = 1;
}
