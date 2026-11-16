import { ProblemDetails } from "@opspilot/contracts";
import type { z } from "zod";

/** An error response from the API, with its problem details. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
  }
}

/**
 * The session's active workspace is no longer the one this page shows (a
 * switch in another tab, or a request that crossed a switch). The page must
 * reload its data rather than show another workspace's under this one's name.
 */
export class WorkspaceChangedError extends Error {
  constructor() {
    super("The active workspace has changed");
    this.name = "WorkspaceChangedError";
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

/** Held by the tab that is refreshing, so other tabs wait for its cookies. */
const REFRESH_LOCK = "opspilot:refresh-session";

let refreshing: Promise<boolean> | undefined;

/**
 * Exchanges the refresh cookie for a new session. Concurrent callers in this
 * tab share one request, and tabs take turns through a Web Lock: a tab that
 * waited then sends the cookie the first tab just received, instead of the
 * one that tab used up. (The API also tolerates the overlap when locks are
 * unavailable, by leaving the newer cookies alone.)
 */
export function refreshSession(): Promise<boolean> {
  const send = () =>
    fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "same-origin",
    }).then((response) => response.ok);
  // Missing in some test environments and very old browsers.
  const locks = navigator.locks as LockManager | undefined;
  refreshing ??= (
    locks === undefined ? send() : locks.request(REFRESH_LOCK, send)
  )
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
  /**
   * The workspace the page is showing. Sent as a precondition on every
   * workspace route, so data from another workspace is never displayed.
   */
  readonly workspaceId?: string;
  /** Cancels the request (TanStack Query passes one to every query). */
  readonly signal?: AbortSignal;
  /**
   * The version the change is based on, sent as `If-Match`. The API refuses
   * the change with `412` if someone else changed the resource meanwhile.
   */
  readonly ifMatch?: number;
  /**
   * Sent as `Idempotency-Key`: a retry of the same create with the same key
   * returns the first response instead of creating a duplicate.
   */
  readonly idempotencyKey?: string;
}

/** Absolute URL on the page's own origin (also works in tests). */
function apiUrl(path: string): string {
  return new URL(`${API_BASE}${path}`, window.location.href).href;
}

async function send(
  path: string,
  method: string,
  options: RequestOptions<unknown>,
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.workspaceId !== undefined) {
    headers["X-Workspace-Id"] = options.workspaceId;
  }
  if (options.ifMatch !== undefined) {
    headers["If-Match"] = `"${String(options.ifMatch)}"`;
  }
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  return fetch(apiUrl(path), {
    method,
    credentials: "same-origin",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
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
  const response = await request(path, options);
  if (options.schema === undefined) {
    return undefined as T;
  }
  return options.schema.parse(await response.json());
}

/** Like `api`, for an answer that is text (a CSV export, say). */
export async function apiText(
  path: string,
  options: Omit<RequestOptions<never>, "schema"> = {},
): Promise<string> {
  const response = await request(path, options);
  return response.text();
}

async function request(
  path: string,
  options: RequestOptions<unknown>,
): Promise<Response> {
  const method = options.method ?? "GET";
  let response = await send(path, method, options);
  if (response.status === 401 && !NO_REFRESH.has(path)) {
    if (!(await refreshSession())) {
      throw new SignedOutError();
    }
    response = await send(path, method, options);
    if (response.status === 401) {
      throw new SignedOutError();
    }
  }
  if (!response.ok) {
    const error = await problemFrom(response);
    if (error.problem.code === "WORKSPACE_CHANGED") {
      throw new WorkspaceChangedError();
    }
    throw error;
  }
  return response;
}
