import { Inject, Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text: readable everywhere, and nothing for a mail client to block. */
  readonly text: string;
}

/**
 * Sends email. An abstract class rather than an interface so it can serve as
 * its own injection token; tests replace it with a capturing fake.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/** Sends through SMTP: Mailpit locally, Amazon SES in production. */
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.transport = createTransport(config.mail.smtpUrl);
    this.from = config.mail.from;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, ...message });
    } catch (error) {
      throw mailDeliveryError(error);
    }
  }
}

/**
 * Never sends to an address that cannot receive email: the reserved
 * `.invalid` top-level domain (RFC 2606), which the demo workspace's people
 * use. Request schemas already refuse such addresses; this guard covers mail
 * to the demo accounts themselves, so the demo never sends a real message
 * and never earns a bounce against the sending domain (FR-AUTH-5).
 */
export class UndeliverableAddressGuard extends Mailer {
  constructor(private readonly inner: Mailer) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    if (message.to.toLowerCase().endsWith(".invalid")) {
      return;
    }
    await this.inner.send(message);
  }
}

/**
 * A mail server refused or could not take a message. Carries only what is
 * safe to log and report: an SMTP server's rejection names the recipient in
 * its text, and Nodemailer copies that text into the error's message, its
 * stack and properties such as `response` and `rejected`. Logs and Sentry
 * must never see an address (NFR-2), and key-based redaction cannot find one
 * inside free text, so nothing of the original error is kept: not even as
 * its `cause`.
 */
export class MailDeliveryError extends Error {
  override readonly name = "MailDeliveryError";

  constructor(
    /** Nodemailer's code, e.g. "EENVELOPE", "ECONNECTION". */
    readonly code: string | undefined,
    /** The SMTP reply code, e.g. 550. */
    readonly responseCode: number | undefined,
    /** The SMTP command that failed, e.g. "RCPT TO". */
    readonly command: string | undefined,
  ) {
    super("The mail server did not accept the message");
  }
}

/**
 * The safe part of a mail transport's error (MailDeliveryError). Only short
 * codes are kept, and only in shapes that cannot hold an address.
 */
export function mailDeliveryError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) {
    return error;
  }
  const fields =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const word = (value: unknown, pattern: RegExp) =>
    typeof value === "string" && pattern.test(value) ? value : undefined;
  const { responseCode } = fields;
  return new MailDeliveryError(
    word(fields.code, /^[A-Z_]{1,32}$/),
    typeof responseCode === "number" && Number.isInteger(responseCode)
      ? responseCode
      : undefined,
    word(fields.command, /^[A-Z ]{1,16}$/),
  );
}
