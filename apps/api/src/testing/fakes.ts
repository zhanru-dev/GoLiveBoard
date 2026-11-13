import type { Clock } from "../shared/clock.js";
import { Mailer, type MailMessage } from "../mail/mailer.js";

/** A clock that stands still until a test moves it. */
export class TestClock implements Clock {
  private current: Date;

  constructor(start = new Date("2026-11-13T09:00:00.000Z")) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/** Keeps every email instead of sending it. */
export class CapturingMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The emails sent to one address, oldest first. */
  to(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}
