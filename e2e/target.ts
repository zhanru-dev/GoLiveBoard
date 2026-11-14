/**
 * What the browser tests run against, chosen with `E2E_TARGET`:
 *
 * - `local` (default): production builds started on this machine
 *   (`npm run start`), behind the development proxy on http://localhost:3300,
 *   with the services from docker-compose.yml.
 * - `stack`: the production images in docker-compose.prod.yml, over HTTPS on
 *   https://opspilot.localhost:3443. This is what CI tests and what ships.
 */
export type E2eTarget = "local" | "stack";

function readTarget(): E2eTarget {
  const value = process.env.E2E_TARGET ?? "local";
  if (value !== "local" && value !== "stack") {
    throw new Error(`E2E_TARGET must be "local" or "stack", not "${value}"`);
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
  stack: {
    baseURL: "https://opspilot.localhost:3443",
    mailpitURL: "http://127.0.0.1:8037",
    composeFile: "docker-compose.prod.yml",
  },
} as const satisfies Record<E2eTarget, unknown>;

export const target = TARGETS[E2E_TARGET];
