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
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
