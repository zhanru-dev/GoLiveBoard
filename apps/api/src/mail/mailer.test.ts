import { describe, expect, it } from "vitest";

import {
  Mailer,
  type MailMessage,
  UndeliverableAddressGuard,
} from "./mailer.js";

class CapturingMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

const message = (to: string): MailMessage => ({
  to,
  subject: "Reset your password",
  text: "…",
});

describe("UndeliverableAddressGuard", () => {
  it("passes ordinary mail on", async () => {
    const inner = new CapturingMailer();

    await new UndeliverableAddressGuard(inner).send(message("ada@example.com"));

    expect(inner.sent).toEqual([message("ada@example.com")]);
  });

  it.each(["visitor@demo.opspilot.invalid", "Owner@Demo.OpsPilot.INVALID"])(
    "never sends to %j, an address that cannot receive email",
    async (to) => {
      const inner = new CapturingMailer();

      await new UndeliverableAddressGuard(inner).send(message(to));

      expect(inner.sent).toEqual([]);
    },
  );
});
