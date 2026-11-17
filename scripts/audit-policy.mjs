/**
 * The dependency audit's rule (docs/06, "Dependency audit"): every advisory
 * of moderate severity or above in production dependencies fails CI, unless
 * audit-allowlist.json lists it with a reason and an expiry date.
 */

const BLOCKING = new Set(["moderate", "high", "critical"]);
const RANK = { low: 0, moderate: 1, high: 2, critical: 3 };
/** How long an allowance may last before it is reviewed again. */
export const MAX_ALLOWANCE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** Why an allowlist entry is not valid as written, or undefined. */
function entryProblem(entry, today) {
  const dated = /^\d{4}-\d{2}-\d{2}$/;
  if (!dated.test(entry.reviewed ?? "") || !dated.test(entry.expires ?? "")) {
    return `${entry.advisory} needs "reviewed" and "expires" dates (YYYY-MM-DD)`;
  }
  if (!(entry.severity in RANK)) {
    return `${entry.advisory} needs the "severity" it was reviewed at`;
  }
  if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
    return `${entry.advisory} needs a reason`;
  }
  if (entry.reviewed > today) {
    return `${entry.advisory} was reviewed on ${entry.reviewed}, after today`;
  }
  if (daysBetween(entry.reviewed, entry.expires) > MAX_ALLOWANCE_DAYS) {
    return `${entry.advisory} is allowed for more than ${String(MAX_ALLOWANCE_DAYS)} days after its review`;
  }
  return undefined;
}

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
    } else if (RANK[advisory.severity] > RANK[allowance.severity]) {
      problems.push(
        `${advisory.id} is now ${advisory.severity}, reviewed as ${allowance.severity}: review it again`,
      );
    }
  }
  const reported = new Set(advisories.map(({ id }) => id));
  for (const entry of allowlist) {
    const problem = entryProblem(entry, today);
    if (problem !== undefined) {
      problems.push(problem);
    }
    if (!reported.has(entry.advisory)) {
      problems.push(
        `${entry.advisory} is no longer reported: remove it from audit-allowlist.json`,
      );
    }
  }
  return { advisories, problems };
}
