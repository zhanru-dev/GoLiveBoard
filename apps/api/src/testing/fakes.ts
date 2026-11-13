import { PasswordHasher } from "../auth/password-hasher.js";
import { Mailer, type MailMessage } from "../mail/mailer.js";
import type { Clock } from "../shared/clock.js";

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

/**
 * The real hasher, except that it can hold one password check until the test
 * releases it: a sign-in can be stopped after it has checked the password and
 * before it starts the session, to stage a race deterministically.
 */
export class PausingPasswordHasher extends PasswordHasher {
  private gate: { reached: () => void; released: Promise<void> } | undefined;

  /** Pauses the next verify() after it has checked the password. */
  pauseNextVerify(): { reached: Promise<void>; release: () => void } {
    const reached = Promise.withResolvers<undefined>();
    const released = Promise.withResolvers<undefined>();
    this.gate = {
      reached: () => {
        reached.resolve(undefined);
      },
      released: released.promise,
    };
    return {
      reached: reached.promise,
      release: () => {
        released.resolve(undefined);
      },
    };
  }

  override async verify(passwordHash: string, password: string) {
    const matches = await super.verify(passwordHash, password);
    const gate = this.gate;
    if (gate !== undefined) {
      this.gate = undefined;
      gate.reached();
      await gate.released;
    }
    return matches;
  }
}
