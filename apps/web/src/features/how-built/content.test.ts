import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_DOC,
  DECISIONS,
  EVIDENCE,
  FIGURES,
  type RepositoryPath,
  ROLLBACK_RUNBOOK,
} from "./content";

// A path, not a URL: under jsdom the global URL is not one Node's fs accepts.
const ROOT = resolve(import.meta.dirname, "../../../../..");

/** Every document the page cites, so a renamed one fails here, not for a reader. */
const CITED: readonly RepositoryPath[] = [
  ...FIGURES.map((figure) => figure.source),
  ...DECISIONS.map((decision) => decision.record),
  ...EVIDENCE.map((item) => item.path),
  ARCHITECTURE_DOC,
  ROLLBACK_RUNBOOK,
];

describe("the How it's built page", () => {
  it.each(CITED)("cites %s, which exists in the repository", (path) => {
    expect(existsSync(resolve(ROOT, path))).toBe(true);
  });
});
