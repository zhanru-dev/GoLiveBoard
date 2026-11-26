import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";

import {
  Mailer,
  MailDeliveryError,
  type MailMessage,
  SesMailer,
  SmtpMailer,
  UndeliverableAddressGuard,
  createMailer,
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

  it.each([
    "visitor@demo.goliveboard.invalid",
    "Owner@Demo.GoLiveBoard.INVALID",
  ])("never sends to %j, an address that cannot receive email", async (to) => {
    const inner = new CapturingMailer();

    await new UndeliverableAddressGuard(inner).send(message(to));

    expect(inner.sent).toEqual([]);
  });
});

describe("SesMailer", () => {
  /** An SES client that records what it is asked to send. */
  function fakeSes(send: (command: SendEmailCommand) => Promise<unknown>) {
    return {
      config: { region: () => Promise.resolve("eu-west-2") },
      send: vi.fn(send),
    };
  }

  it("sends through SES's API from the site's address, in its configuration set", async () => {
    const client = fakeSes(() => Promise.resolve({ MessageId: "ses-1" }));
    const mailer = new SesMailer(
      {
        region: "eu-west-2",
        from: "GoLiveBoard <no-reply@goliveboard.example.com>",
        configurationSet: "goliveboard-demo",
      },
      client as never,
    );

    await mailer.send({
      to: "ada@example.com",
      subject: "Confirm your registration",
      text: "Thanks for registering.",
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command?.input).toMatchObject({
      ConfigurationSetName: "goliveboard-demo",
      FromEmailAddress: "GoLiveBoard <no-reply@goliveboard.example.com>",
      Destination: { ToAddresses: ["ada@example.com"] },
    });
    const raw = Buffer.from(command?.input.Content?.Raw?.Data ?? []).toString();
    expect(raw).toContain("Subject: Confirm your registration");
  });

  it("keeps the recipient out of what a refused message throws", async () => {
    const refusal = Object.assign(
      new Error(
        "Email address is not verified. The following identities failed the check in region EU-WEST-2: ada@example.com",
      ),
      { name: "MessageRejected", $metadata: { httpStatusCode: 400 } },
    );
    const mailer = new SesMailer(
      {
        region: "eu-west-2",
        from: "no-reply@goliveboard.example.com",
        configurationSet: undefined,
      },
      fakeSes(() => Promise.reject(refusal)) as never,
    );

    const thrown = await mailer
      .send({ to: "ada@example.com", subject: "Hello", text: "…" })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(MailDeliveryError);
    const everything = JSON.stringify(
      thrown,
      Object.getOwnPropertyNames(thrown),
    );
    expect(everything).not.toContain("ada@example.com");
    expect((thrown as Error).cause).toBeUndefined();
  });
});

describe("createMailer", () => {
  it("uses the configured transport, always behind the undeliverable-address guard", () => {
    const ses = createMailer({
      transport: "ses",
      region: "eu-west-2",
      from: "no-reply@goliveboard.example.com",
      configurationSet: "goliveboard-demo",
    });
    const smtp = createMailer({
      transport: "smtp",
      smtpUrl: "smtp://127.0.0.1:1025",
      from: "no-reply@goliveboard.test",
    });

    expect(ses).toBeInstanceOf(UndeliverableAddressGuard);
    expect((ses as UndeliverableAddressGuard).inner).toBeInstanceOf(SesMailer);
    expect((smtp as UndeliverableAddressGuard).inner).toBeInstanceOf(
      SmtpMailer,
    );
  });
});
