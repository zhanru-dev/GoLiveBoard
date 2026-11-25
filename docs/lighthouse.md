# Lighthouse scores (milestone 9)

The public event page is the page attendees land on from an invitation (FR-AD-1), and the one with a performance budget (NFR-3). Lighthouse measures it on every CI run, against the production-like stack.

**How it is measured** (`lighthouserc.cjs`, `scripts/lighthouse-inp.mjs`):

- Lighthouse 13.6.0 emulates a mid-range phone on slow 4G (its mobile default, simulated throttling). It runs 3 times, and the median run counts.
- Interaction to Next Paint needs an interaction. A separate user flow fills in and submits the registration form 5 times; its median counts.
- The page is the seeded demo event, "Autumn product launch".

## Budgets

| Measure                   | Budget                        | Enforced                                                                                   |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Largest Contentful Paint  | ≤ 2.5 s                       | Fails CI                                                                                   |
| Cumulative Layout Shift   | ≤ 0.1                         | Fails CI                                                                                   |
| Interaction to Next Paint | ≤ 200 ms                      | Fails CI                                                                                   |
| JavaScript, compressed    | ≤ 150 kB (docs/05, section 9) | Fails CI                                                                                   |
| Accessibility score       | ≥ 0.95                        | Fails CI                                                                                   |
| Total Blocking Time       | ≤ 200 ms                      | Warning only: React and the Next.js runtime alone take about 200 ms on this emulated phone |

## Results

The median run of each.

| Run                                                                             | Performance | Accessibility | Best practices | LCP    | CLS | TBT    | INP   | JavaScript |
| ------------------------------------------------------------------------------- | ----------- | ------------- | -------------- | ------ | --- | ------ | ----- | ---------- |
| CI run 44437926750, 2026-11-19, `a352246`, GitHub's amd64 runner                | **0.99**    | **1.00**      | 0.96           | 0.80 s | 0   | 139 ms | 49 ms | 141.7 kB   |
| Local stack, 2026-11-19, with the icon fix, Intel i9-9880H                      | **0.96**    | **1.00**      | **1.00**       | 0.80 s | 0   | 215 ms | 75 ms | 141.7 kB   |
| CI run 44446991150, 2026-11-19, `7a65072` (the icon fix), GitHub's amd64 runner | **0.92**    | **1.00**      | **1.00**       | 0.96 s | 0   | 345 ms | 63 ms | 141.7 kB   |

The three runs of each:

- **CI, `a352246`:** performance 0.95–0.99, LCP 0.80–0.96 s.
- **CI, `7a65072`:** performance 0.85–0.92, LCP 0.82–1.02 s, TBT 345–586 ms. The page did not change between the two runs except for the icon; Total Blocking Time is the measure that moves most with the runner's load, and the one that is a warning, not a gate.
- **Local:** performance 0.94–0.96, LCP 0.80–0.83 s.

**Best practices, 0.96 → 1.00.**

- **Found:** the one failing audit was "errors in the console". Browsers asked for `/favicon.ico`, which did not exist, because no page declared an icon.
- **Fixed:** the app now has an icon (`apps/web/src/app/icon.svg`), declared on every page.
- **Kept fixed:** `e2e/console.spec.ts` checks that public pages log no errors and fail no requests, and that their icon loads. Headless browsers never ask for an icon, so the test checks it explicitly.

**Headroom.**

- **JavaScript:** 141.7 kB of 150 kB. The next dependency added to the public page should be weighed against this budget.
- **Total Blocking Time:** the one measure near or over its line (139–345 ms in the medians above). It is the next performance work if the public page grows.

**Not measured by Lighthouse:**

- **The signed-in app.** Its pages need a session; their accessibility is covered by axe and the keyboard walkthrough ([accessibility-audit.md](accessibility-audit.md)).
- **The watch page.** It plays a customer's stream.

The CI reports are kept as the run's `lighthouse` artifact.

## Milestone 10: error boundaries and field data

Two changes in milestone 10 added JavaScript to the public event page:

- **Error boundaries (batch 6):** every route group's error page and the global one are loaded with each page.
- **Web Vitals from real visits (batch 7):** `web-vitals` (3.2 kB) and the beacon that sends them.

**A correction.** The commit of batch 6 (`d583b62`) said the page's JavaScript was unchanged at 141.7 kB. That Lighthouse run reached the stack under review on the same ports, still at `09b2a2e`, not the one built from batch 6; nothing was measured on the change itself.

**Measured on the stack built from the change** (ports moved: `STACK_HTTPS_PORT=4443`):

- **Before trimming:** 149.6 kB, with both changes. Each error page carried its own copy of the button styles' engine.
- **After:** 147.4 kB. The error pages' button is written out; `web-vitals` stays.
- **Headroom:** 2.6 kB under the 150 kB budget, down from 8.3 kB. The next change to this page has to pay for itself.

**Field data now exists beside this lab data:** the dashboard's "Real visits" row shows LCP, INP and CLS at the 75th percentile of real visits, the form NFR-3 states its targets in. An alert fires when the public page's LCP is above 2.5 s, once there are enough visits to judge.
