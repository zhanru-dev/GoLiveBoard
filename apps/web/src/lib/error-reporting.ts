import type { BrowserOptions, ErrorEvent } from "@sentry/nextjs";

/**
 * Where the web app's errors go. Read from the web server's environment at
 * run time and handed to the browser in the page (a `<meta>` tag), so one
 * image works in every environment: nothing is fixed at build time.
 */
export interface ErrorReportingSettings {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string | undefined;
}

/**
 * Checks settings from the environment or the page. Written out rather than
 * with Zod: this runs on every page in the browser, and Zod alone would
 * weigh more than the page it reports for (NFR-3).
 *
 * @returns the settings, or null when anything is missing or malformed
 */
export function parseErrorReportingSettings(
  value: unknown,
): ErrorReportingSettings | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { dsn, environment, release } = value as Record<string, unknown>;
  const protocol =
    typeof dsn === "string" ? URL.parse(dsn)?.protocol : undefined;
  const validRelease =
    release === undefined ||
    (typeof release === "string" &&
      release.length >= 1 &&
      release.length <= 200);
  if (
    typeof dsn !== "string" ||
    (protocol !== "https:" && protocol !== "http:") ||
    typeof environment !== "string" ||
    environment.length < 1 ||
    environment.length > 64 ||
    !validRelease
  ) {
    return null;
  }
  return { dsn, environment, release };
}

/** The name of the `<meta>` tag that carries the settings to the browser. */
export const ERROR_REPORTING_META = "opspilot-error-reporting";

/**
 * The settings from the server's environment, or null when reporting is off
 * (no `SENTRY_DSN`) or the DSN is malformed.
 */
export function errorReportingSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ErrorReportingSettings | null {
  // Compose passes an unset variable as an empty string: not set.
  const setting = (value: string | undefined) =>
    value === "" ? undefined : value;
  return parseErrorReportingSettings({
    dsn: setting(env.SENTRY_DSN),
    environment:
      setting(env.SENTRY_ENVIRONMENT) ?? setting(env.NODE_ENV) ?? "production",
    release: setting(env.SENTRY_RELEASE),
  });
}

/** The settings the server put in the page, or null. */
export function errorReportingSettingsFromPage(
  document: Pick<Document, "querySelector">,
): ErrorReportingSettings | null {
  const content = document
    .querySelector(`meta[name="${ERROR_REPORTING_META}"]`)
    ?.getAttribute("content");
  if (content === null || content === undefined) {
    return null;
  }
  try {
    return parseErrorReportingSettings(JSON.parse(content));
  } catch {
    return null;
  }
}

/** The origin errors are sent to, for the Content Security Policy. */
export function errorReportingOrigin(
  settings: ErrorReportingSettings | null,
): string | null {
  return settings === null ? null : new URL(settings.dsn).origin;
}

/**
 * Options shared by the browser and the web server: errors only (tracing
 * arrives in milestone 9), and nothing that could identify a person or carry
 * a secret. Sentry's defaults collect all of it.
 */
export function sentryOptions(
  settings: ErrorReportingSettings,
  processName: "browser" | "web-server",
) {
  return {
    dsn: settings.dsn,
    environment: settings.environment,
    release: settings.release,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    // Breadcrumbs would carry URLs, clicked text and console output.
    maxBreadcrumbs: 0,
    initialScope: { tags: { process: processName } },
    beforeSend: scrubEvent,
  } satisfies BrowserOptions;
}

/**
 * Removes what could identify a person or carry a secret: request details
 * other than the method and path (links carry one-time tokens in the query
 * or the fragment), user details and local variables.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { request } = event;
  if (request !== undefined) {
    event.request = {
      method: request.method,
      url: request.url?.split(/[?#]/, 1)[0],
    };
  }
  delete event.user;
  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
  return event;
}
