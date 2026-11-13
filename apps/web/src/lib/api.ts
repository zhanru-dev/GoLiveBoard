import { ProblemDetails } from "@opspilot/contracts";
import type { z } from "zod";

/** An error response from the API, with its problem details. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
  }
}

/** The session could not be restored; the user must sign in again. */
export class SignedOutError extends Error {
  constructor() {
    super("Signed out");
    this.name = "SignedOutError";
  }
}

const API_BASE = "/api/v1";

/** Requests that must never trigger a refresh (they are the session machinery). */
const NO_REFRESH = new Set([
  "/auth/refresh",
  "/auth/sign-in",
  "/auth/sign-out",
]);

let refreshing: Promise<boolean> | undefined;

/**
 * Exchanges the refresh cookie for a new session. Concurrent callers share one
 * request: several queries failing at once must not refresh several times.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    credentials: "same-origin",
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

interface RequestOptions<T> {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  /** Validates the response body; omit for `204` responses. */
  readonly schema?: z.ZodType<T>;
}

/** Absolute URL on the page's own origin (also works in tests). */
function apiUrl(path: string): string {
  return new URL(`${API_BASE}${path}`, window.location.href).href;
}

async function send(path: string, method: string, body: unknown) {
  return fetch(apiUrl(path), {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function problemFrom(response: Response): Promise<ApiError> {
  const parsed = ProblemDetails.safeParse(
    await response.json().catch(() => ({})),
  );
  return new ApiError(
    parsed.success
      ? parsed.data
      : {
          type: "about:blank",
          title: "Something went wrong",
          status: response.status,
          code: "INTERNAL_ERROR",
          requestId: response.headers.get("x-request-id") ?? "unknown",
        },
  );
}

/**
 * Calls the API on the same origin. An expired access token is renewed once,
 * transparently; if that fails the caller gets a SignedOutError.
 */
export async function api<T = undefined>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const method = options.method ?? "GET";
  let response = await send(path, method, options.body);
  if (response.status === 401 && !NO_REFRESH.has(path)) {
    if (!(await refreshSession())) {
      throw new SignedOutError();
    }
    response = await send(path, method, options.body);
    if (response.status === 401) {
      throw new SignedOutError();
    }
  }
  if (!response.ok) {
    throw await problemFrom(response);
  }
  if (options.schema === undefined) {
    return undefined as T;
  }
  return options.schema.parse(await response.json());
}
