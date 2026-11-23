import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { createTransport, type Transporter } from "nodemailer";

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

/** Sends through SMTP: Mailpit locally, or any SMTP server. */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(settings: { readonly smtpUrl: string; readonly from: string }) {
    super();
    this.transport = createTransport(settings.smtpUrl);
    this.from = settings.from;
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
 * Sends through Amazon SES's API (AWS, docs/06 section 5), signed with the
 * host's own role: there are no SMTP credentials to leak or rotate. Each
 * message names the configuration set, so SES suppresses addresses that
 * bounce or complain and keeps the sender's reputation metrics.
 */
export class SesMailer extends Mailer {
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly configurationSet: string | undefined;

  constructor(
    settings: {
      readonly region: string;
      readonly from: string;
      readonly configurationSet: string | undefined;
    },
    client: Pick<SESv2Client, "send" | "config"> = new SESv2Client({
      region: settings.region,
    }),
  ) {
    super();
    this.transport = createTransport({
      SES: { sesClient: client, SendEmailCommand },
    });
    this.from = settings.from;
    this.configurationSet = settings.configurationSet;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        ...message,
        ses:
          this.configurationSet === undefined
            ? {}
            : { ConfigurationSetName: this.configurationSet },
      });
    } catch (error) {
      // SES names a refused recipient in its message too: as for SMTP,
      // nothing but short codes is kept.
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
  constructor(readonly inner: Mailer) {
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
 * The application's mailer: the configured transport, behind the guard that
 * never sends to undeliverable demo addresses.
 */
export function createMailer(
  settings:
    | {
        readonly transport: "smtp";
        readonly smtpUrl: string;
        readonly from: string;
      }
    | {
        readonly transport: "ses";
        readonly region: string;
        readonly from: string;
        readonly configurationSet: string | undefined;
      },
): Mailer {
  return new UndeliverableAddressGuard(
    settings.transport === "ses"
      ? new SesMailer(settings)
      : new SmtpMailer(settings),
  );
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
