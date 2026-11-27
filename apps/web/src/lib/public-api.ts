import { traceparent } from "./traceparent";

/**
 * Calls the API from the public event page. Deliberately small: no Zod, no
 * session refresh, no React Query. The page has a performance budget
 * (NFR-3), and the API validates everything anyway.
 */

export interface PublicFieldError {
  readonly path: string;
  readonly message: string;
}

export type PublicResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: number;
      /** For the whole form. */
      readonly message: string;
      readonly errors: readonly PublicFieldError[];
    };

export async function postPublic(
  path: string,
  body?: object,
): Promise<PublicResult> {
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1${path}`, window.location.href), {
      method: "POST",
      credentials: "same-origin",
      headers:
        body === undefined
          ? { traceparent: traceparent() }
          : { "Content-Type": "application/json", traceparent: traceparent() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return failure(0, "Could not reach GoLiveBoard. Check your connection.");
  }
  if (response.ok) {
    return { ok: true };
  }
  const problem: unknown = await response.json().catch(() => null);
  return failure(
    response.status,
    textOf(problem, "detail") ??
      textOf(problem, "title") ??
      "Something went wrong. Please try again.",
    fieldErrorsOf(problem),
  );
}

function failure(
  status: number,
  message: string,
  errors: readonly PublicFieldError[] = [],
): PublicResult {
  return { ok: false, status, message, errors };
}

function textOf(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field: unknown = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function fieldErrorsOf(problem: unknown): PublicFieldError[] {
  if (typeof problem !== "object" || problem === null) {
    return [];
  }
  const errors: unknown = (problem as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((error: unknown) => {
    const path = textOf(error, "path");
    const message = textOf(error, "message");
    return path === undefined || message === undefined
      ? []
      : [{ path, message }];
  });
}

export type PublicResponse<T> =
  | { readonly ok: true; readonly body: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly message: string;
      /** The problem's machine-readable code, when the API sent one. */
      readonly code?: string;
    };

/**
 * A request from an attendee's page that returns JSON. The API's answer is
 * trusted as typed: the page is kept free of a validation library.
 */
export async function requestPublic<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { body?: object; headers?: Record<string, string> } = {},
): Promise<PublicResponse<T>> {
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1${path}`, window.location.href), {
      method,
      credentials: "same-origin",
      headers: {
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: "Could not reach GoLiveBoard. Check your connection.",
    };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    return { ok: true, body: body as T };
  }
  const code = textOf(body, "code");
  return {
    ok: false,
    status: response.status,
    ...(code !== undefined && { code }),
    message:
      textOf(body, "detail") ??
      textOf(body, "title") ??
      "Something went wrong. Please try again.",
  };
}
