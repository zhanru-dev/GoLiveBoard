/**
 * What the browser tests run against, chosen with `E2E_TARGET`:
 *
 * - `local` (default): production builds started on this machine
 *   (`npm run start`), behind the development proxy on http://localhost:3300,
 *   with the services from docker-compose.yml.
 * - `stack`: the production images in docker-compose.prod.yml, over HTTPS on
 *   https://opspilot.localhost:3443. This is what CI tests and what ships.
 * - `deployed`: a deployed environment at `DEPLOYED_URL`; only the smoke
 *   tests in e2e/deployed.spec.ts run there (the deploy pipeline's check
 *   before it keeps a release, docs/06 section 4).
 */
export type E2eTarget = "local" | "stack" | "deployed";

function readTarget(): E2eTarget {
  const value = process.env.E2E_TARGET ?? "local";
  if (value !== "local" && value !== "stack" && value !== "deployed") {
    throw new Error(
      `E2E_TARGET must be "local", "stack" or "deployed", not "${value}"`,
    );
  }
  return value;
}

export const E2E_TARGET = readTarget();

const TARGETS = {
  local: {
    baseURL: "http://localhost:3300",
    mailpitURL: "http://127.0.0.1:8036",
    composeFile: "docker-compose.yml",
  },
  // The stack's ports can be moved with the same variables as its compose
  // file, so two stacks (one under review, say) can run side by side.
  stack: {
    baseURL: `https://opspilot.localhost:${process.env.STACK_HTTPS_PORT ?? "3443"}`,
    mailpitURL: `http://127.0.0.1:${process.env.STACK_MAILPIT_UI_PORT ?? "8037"}`,
    composeFile: "docker-compose.prod.yml",
  },
  deployed: {
    baseURL: process.env.DEPLOYED_URL ?? "https://deployed.invalid",
    mailpitURL: "",
    composeFile: "",
  },
} as const satisfies Record<E2eTarget, unknown>;

export const target = TARGETS[E2E_TARGET];
