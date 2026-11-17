/**
 * The dependency audit's rule (docs/06, "Dependency audit"): every advisory
 * of moderate severity or above in production dependencies fails CI, unless
 * audit-allowlist.json lists it with a reason and an expiry date.
 */

const BLOCKING = new Set(["moderate", "high", "critical"]);

/** The advisory ID (GHSA-…) in an advisory's URL. */
function advisoryId(url) {
  return /GHSA-[\w-]+/.exec(url ?? "")?.[0] ?? url;
}

/**
 * The advisories an `npm audit --json` report names, of a blocking
 * severity: one entry each, with the packages it was found in.
 */
export function advisoriesIn(report) {
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(
    report.vulnerabilities ?? {},
  )) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) {
        continue;
      }
      const id = advisoryId(via.url);
      const entry = found.get(id) ?? {
        id,
        title: via.title,
        severity: via.severity,
        packages: new Set(),
      };
      entry.packages.add(via.name ?? name);
      found.set(id, entry);
    }
  }
  return [...found.values()];
}

/**
 * What fails the audit: an advisory not allowed, an allowance past its
 * expiry date (to be reviewed again), and one for an advisory no longer
 * reported (to be removed). `today` is a "YYYY-MM-DD" date.
 */
export function judge(report, allowlist, today) {
  const advisories = advisoriesIn(report);
  const allowed = new Map(allowlist.map((entry) => [entry.advisory, entry]));
  const problems = [];
  for (const advisory of advisories) {
    const allowance = allowed.get(advisory.id);
    const where = [...advisory.packages].join(", ");
    if (allowance === undefined) {
      problems.push(
        `${advisory.id} (${advisory.severity}, ${where}): ${advisory.title}`,
      );
    } else if (allowance.expires < today) {
      problems.push(
        `${advisory.id} is allowed until ${allowance.expires} only: review it again`,
      );
    }
  }
  const reported = new Set(advisories.map(({ id }) => id));
  for (const entry of allowlist) {
    if (!reported.has(entry.advisory)) {
      problems.push(
        `${entry.advisory} is no longer reported: remove it from audit-allowlist.json`,
      );
    }
  }
  return { advisories, problems };
}
