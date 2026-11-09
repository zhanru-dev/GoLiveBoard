import type { ErrorCode } from "@opspilot/contracts";

export interface DomainErrorOptions {
  /** Explanation for this occurrence, shown to the user. Never include secrets. */
  readonly detail?: string;
  /** Extra members for the problem response, e.g. `{ blockers: [...] }`. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/**
 * Thrown when a business rule refuses a request. The exception filter turns it
 * into a problem response with the code's status and title, so services and
 * domain functions never deal with HTTP.
 */
export class DomainError extends Error {
  override readonly name = "DomainError";
  readonly detail: string | undefined;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: ErrorCode,
    options: DomainErrorOptions = {},
  ) {
    super(options.detail ?? code, { cause: options.cause });
    this.detail = options.detail;
    this.extensions = options.extensions ?? {};
  }
}
