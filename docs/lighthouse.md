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

| Run                                                              | Performance | Accessibility | Best practices | LCP    | CLS | TBT    | INP   | JavaScript |
| ---------------------------------------------------------------- | ----------- | ------------- | -------------- | ------ | --- | ------ | ----- | ---------- |
| CI run 44437926750, 2026-11-19, `a352246`, GitHub's amd64 runner | **0.99**    | **1.00**      | 0.96           | 0.80 s | 0   | 139 ms | 49 ms | 141.7 kB   |
| Local stack, 2026-11-19, with the icon fix, Intel i9-9880H       | **0.96**    | **1.00**      | **1.00**       | 0.80 s | 0   | 215 ms | 75 ms | 141.7 kB   |

All three runs of each were within a few points of the median:

- **CI:** performance 0.95–0.99, LCP 0.80–0.96 s.
- **Local:** performance 0.94–0.96, LCP 0.80–0.83 s.

**Best practices, 0.96 → 1.00.**

- **Found:** the one failing audit was "errors in the console". Browsers asked for `/favicon.ico`, which did not exist, because no page declared an icon.
- **Fixed:** the app now has an icon (`apps/web/src/app/icon.svg`), declared on every page.
- **Kept fixed:** `e2e/console.spec.ts` checks that public pages log no errors and fail no requests, and that their icon loads. Headless browsers never ask for an icon, so the test checks it explicitly.

**Headroom.**

- **JavaScript:** 141.7 kB of 150 kB. The next dependency added to the public page should be weighed against this budget.
- **Total Blocking Time:** the one measure near its line, as explained above.

**Not measured by Lighthouse:**

- **The signed-in app.** Its pages need a session; their accessibility is covered by axe and the keyboard walkthrough ([accessibility-audit.md](accessibility-audit.md)).
- **The watch page.** It plays a customer's stream.

The CI reports are kept as the run's `lighthouse` artifact.
