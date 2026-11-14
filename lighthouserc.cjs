/**
 * Lighthouse CI for the public event page (NFR-3, FR-AD-1), run by the
 * images job against the production-like stack (docs/06, section 1.4).
 *
 * The page to test comes from LIGHTHOUSE_URL. Lighthouse emulates a mid-range
 * phone on a slow 4G connection (its default), the hard case. Interaction to
 * Next Paint needs real interactions, so in the lab Total Blocking Time
 * stands in for it.
 */
module.exports = {
  ci: {
    collect: {
      url: [process.env.LIGHTHOUSE_URL],
      numberOfRuns: 3,
      chromePath: process.env.CHROME_PATH,
      settings: {
        // The stack's certificate comes from Caddy's local authority.
        chromeFlags: "--headless=new --no-sandbox --ignore-certificate-errors",
        onlyCategories: ["performance", "accessibility", "best-practices"],
      },
    },
    assert: {
      // The median of the runs, not the best or the worst.
      aggregationMethod: "median-run",
      assertions: {
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "total-blocking-time": ["error", { maxNumericValue: 200 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};
